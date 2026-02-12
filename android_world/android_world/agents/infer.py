# Copyright 2025 The android_world Authors.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Some LLM inference interface."""

import abc
import base64
import io
import os
import time
from typing import Any, Optional
import google.generativeai as genai
from google.generativeai import types
from google.generativeai.types import answer_types
from google.generativeai.types import content_types
from google.generativeai.types import generation_types
from google.generativeai.types import safety_types
import numpy as np
from PIL import Image
import requests

# Optional Vertex AI import for service account auth
try:
  import vertexai
  from vertexai.generative_models import GenerativeModel, Part, Image as VertexImage
  from vertexai.generative_models import SafetySetting, HarmCategory, HarmBlockThreshold
  from vertexai.generative_models import GenerationConfig as VertexGenerationConfig
  VERTEX_AI_AVAILABLE = True
except ImportError:
  VERTEX_AI_AVAILABLE = False


ERROR_CALLING_LLM = 'Error calling LLM'


def array_to_jpeg_bytes(image: np.ndarray) -> bytes:
  """Converts a numpy array into a byte string for a JPEG image."""
  image = Image.fromarray(image)
  return image_to_jpeg_bytes(image)


def image_to_jpeg_bytes(image: Image.Image) -> bytes:
  in_mem_file = io.BytesIO()
  image.save(in_mem_file, format='JPEG')
  # Reset file pointer to start
  in_mem_file.seek(0)
  img_bytes = in_mem_file.read()
  return img_bytes


class LlmWrapper(abc.ABC):
  """Abstract interface for (text only) LLM."""

  @abc.abstractmethod
  def predict(
      self,
      text_prompt: str,
  ) -> tuple[str, Optional[bool], Any]:
    """Calling text-only LLM with a prompt.

    Args:
      text_prompt: Text prompt.

    Returns:
      Text output, is_safe, and raw output.
    """


class MultimodalLlmWrapper(abc.ABC):
  """Abstract interface for Multimodal LLM."""

  @abc.abstractmethod
  def predict_mm(
      self, text_prompt: str, images: list[np.ndarray]
  ) -> tuple[str, Optional[bool], Any]:
    """Calling multimodal LLM with a prompt and a list of images.

    Args:
      text_prompt: Text prompt.
      images: List of images as numpy ndarray.

    Returns:
      Text output and raw output.
    """


SAFETY_SETTINGS_BLOCK_NONE = {
    types.HarmCategory.HARM_CATEGORY_HARASSMENT: (
        types.HarmBlockThreshold.BLOCK_NONE
    ),
    types.HarmCategory.HARM_CATEGORY_HATE_SPEECH: (
        types.HarmBlockThreshold.BLOCK_NONE
    ),
    types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: (
        types.HarmBlockThreshold.BLOCK_NONE
    ),
    types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: (
        types.HarmBlockThreshold.BLOCK_NONE
    ),
}


class GeminiGcpWrapper(LlmWrapper, MultimodalLlmWrapper):
  """Gemini GCP interface."""

  def __init__(
      self,
      model_name: str | None = None,
      max_retry: int = 3,
      temperature: float = 0.0,
      top_p: float = 0.95,
      enable_safety_checks: bool = True,
  ):
    if 'GCP_API_KEY' not in os.environ:
      raise RuntimeError('GCP API key not set.')
    genai.configure(api_key=os.environ['GCP_API_KEY'])
    self.llm = genai.GenerativeModel(
        model_name,
        safety_settings=None
        if enable_safety_checks
        else SAFETY_SETTINGS_BLOCK_NONE,
        generation_config=generation_types.GenerationConfig(
            temperature=temperature, top_p=top_p
        ),
    )
    if max_retry <= 0:
      max_retry = 3
      print('Max_retry must be positive. Reset it to 3')
    self.max_retry = min(max_retry, 5)

  def predict(
      self,
      text_prompt: str,
      enable_safety_checks: bool = True,
      generation_config: generation_types.GenerationConfigType | None = None,
  ) -> tuple[str, Optional[bool], Any]:
    return self.predict_mm(
        text_prompt, [], enable_safety_checks, generation_config
    )

  def is_safe(self, raw_response):
    try:
      return (
          raw_response.candidates[0].finish_reason
          != answer_types.FinishReason.SAFETY
      )
    except Exception:  # pylint: disable=broad-exception-caught
      #  Assume safe if the response is None or doesn't have candidates.
      return True

  def predict_mm(
      self,
      text_prompt: str,
      images: list[np.ndarray],
      enable_safety_checks: bool = True,
      generation_config: generation_types.GenerationConfigType | None = None,
  ) -> tuple[str, Optional[bool], Any]:
    counter = self.max_retry
    retry_delay = 1.0
    output = None
    while counter > 0:
      try:
        output = self.llm.generate_content(
            [text_prompt] + [Image.fromarray(image) for image in images],
            safety_settings=None
            if enable_safety_checks
            else SAFETY_SETTINGS_BLOCK_NONE,
            generation_config=generation_config,
        )
        return output.text, True, output
      except Exception as e:  # pylint: disable=broad-exception-caught
        counter -= 1
        print('Error calling LLM, will retry in {retry_delay} seconds')
        print(e)
        if counter > 0:
          # Expo backoff
          time.sleep(retry_delay)
          retry_delay *= 2

    if (output is not None) and (not self.is_safe(output)):
      return ERROR_CALLING_LLM, False, output
    return ERROR_CALLING_LLM, None, None

  def generate(
      self,
      contents: (
          content_types.ContentsType | list[str | np.ndarray | Image.Image]
      ),
      safety_settings: safety_types.SafetySettingOptions | None = None,
      generation_config: generation_types.GenerationConfigType | None = None,
  ) -> tuple[str, Any]:
    """Exposes the generate_content API.

    Args:
      contents: The input to the LLM.
      safety_settings: Safety settings.
      generation_config: Generation config.

    Returns:
      The output text and the raw response.
    Raises:
      RuntimeError:
    """
    counter = self.max_retry
    retry_delay = 1.0
    response = None
    if isinstance(contents, list):
      contents = self.convert_content(contents)
    while counter > 0:
      try:
        response = self.llm.generate_content(
            contents=contents,
            safety_settings=safety_settings,
            generation_config=generation_config,
        )
        return response.text, response
      except Exception as e:  # pylint: disable=broad-exception-caught
        counter -= 1
        print('Error calling LLM, will retry in {retry_delay} seconds')
        print(e)
        if counter > 0:
          # Expo backoff
          time.sleep(retry_delay)
          retry_delay *= 2
    raise RuntimeError(f'Error calling LLM. {response}.')

  def convert_content(
      self,
      contents: list[str | np.ndarray | Image.Image],
  ) -> content_types.ContentsType:
    """Converts a list of contents to a ContentsType."""
    converted = []
    for item in contents:
      if isinstance(item, str):
        converted.append(item)
      elif isinstance(item, np.ndarray):
        converted.append(Image.fromarray(item))
      elif isinstance(item, Image.Image):
        converted.append(item)
    return converted


class Gemini25ProWrapper(LlmWrapper, MultimodalLlmWrapper):
  """Gemini 2.5 Pro wrapper using Vertex AI with service account auth.

  This wrapper uses Vertex AI SDK which supports service account authentication
  via GOOGLE_APPLICATION_CREDENTIALS environment variable.

  Attributes:
    model_name: Gemini model name (default: gemini-2.5-pro-preview-06-05)
    project_id: GCP project ID
    location: GCP region (default: us-central1)
    max_retry: Max number of retries
    temperature: Temperature for generation
  """

  DEFAULT_MODEL = 'gemini-2.5-pro'

  def __init__(
      self,
      model_name: str | None = None,
      project_id: str | None = None,
      location: str = 'us-central1',
      max_retry: int = 3,
      temperature: float = 0.0,
      top_p: float = 0.95,
      enable_safety_checks: bool = True,
  ):
    if not VERTEX_AI_AVAILABLE:
      raise RuntimeError(
          'Vertex AI SDK not installed. Run: pip install google-cloud-aiplatform'
      )

    # Check for service account credentials
    if 'GOOGLE_APPLICATION_CREDENTIALS' not in os.environ:
      raise RuntimeError(
          'GOOGLE_APPLICATION_CREDENTIALS not set. '
          'Set it to the path of your service account JSON file.'
      )

    # Get project ID from env or parameter
    self.project_id = project_id or os.environ.get('GCP_PROJECT_ID')
    if not self.project_id:
      raise RuntimeError(
          'GCP project ID not set. Either pass project_id parameter or '
          'set GCP_PROJECT_ID environment variable.'
      )

    self.location = location
    self.model_name = model_name or self.DEFAULT_MODEL
    self.temperature = temperature
    self.top_p = top_p
    self.enable_safety_checks = enable_safety_checks

    if max_retry <= 0:
      max_retry = 3
      print('Max_retry must be positive. Reset it to 3')
    self.max_retry = min(max_retry, 5)

    # Initialize Vertex AI
    vertexai.init(project=self.project_id, location=self.location)
    self.llm = GenerativeModel(self.model_name)

    # Setup safety settings
    if not enable_safety_checks:
      self.safety_settings = [
          SafetySetting(
              category=HarmCategory.HARM_CATEGORY_HARASSMENT,
              threshold=HarmBlockThreshold.OFF,
          ),
          SafetySetting(
              category=HarmCategory.HARM_CATEGORY_HATE_SPEECH,
              threshold=HarmBlockThreshold.OFF,
          ),
          SafetySetting(
              category=HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
              threshold=HarmBlockThreshold.OFF,
          ),
          SafetySetting(
              category=HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
              threshold=HarmBlockThreshold.OFF,
          ),
      ]
    else:
      self.safety_settings = None

    # Setup generation config
    self.generation_config = VertexGenerationConfig(
        temperature=temperature,
        top_p=top_p,
        max_output_tokens=8192,
    )

    print(f'Initialized Gemini 2.5 Pro: model={self.model_name}, '
          f'project={self.project_id}, location={self.location}')

  def predict(
      self,
      text_prompt: str,
  ) -> tuple[str, Optional[bool], Any]:
    return self.predict_mm(text_prompt, [])

  def predict_mm(
      self,
      text_prompt: str,
      images: list[np.ndarray],
  ) -> tuple[str, Optional[bool], Any]:
    counter = self.max_retry
    retry_delay = 1.0
    output = None

    # Build content list
    contents = [text_prompt]
    for image in images:
      # Convert numpy array to bytes
      img_bytes = array_to_jpeg_bytes(image)
      contents.append(Part.from_data(img_bytes, mime_type='image/jpeg'))

    while counter > 0:
      try:
        output = self.llm.generate_content(
            contents,
            safety_settings=self.safety_settings,
            generation_config=self.generation_config,
        )
        return output.text, True, output
      except Exception as e:  # pylint: disable=broad-exception-caught
        counter -= 1
        print(f'Error calling Gemini 2.5 Pro, will retry in {retry_delay}s: {e}')
        if counter > 0:
          time.sleep(retry_delay)
          retry_delay *= 2

    return ERROR_CALLING_LLM, None, None


class Gpt4Wrapper(LlmWrapper, MultimodalLlmWrapper):
  """OpenAI GPT4 wrapper.

  Attributes:
    openai_api_key: The class gets the OpenAI api key either explicitly, or
      through env variable in which case just leave this empty.
    max_retry: Max number of retries when some error happens.
    temperature: The temperature parameter in LLM to control result stability.
    model: GPT model to use based on if it is multimodal.
  """

  RETRY_WAITING_SECONDS = 20

  def __init__(
      self,
      model_name: str,
      max_retry: int = 3,
      temperature: float = 0.0,
  ):
    if 'OPENAI_API_KEY' not in os.environ:
      raise RuntimeError('OpenAI API key not set.')
    self.openai_api_key = os.environ['OPENAI_API_KEY']
    if max_retry <= 0:
      max_retry = 3
      print('Max_retry must be positive. Reset it to 3')
    self.max_retry = min(max_retry, 5)
    self.temperature = temperature
    self.model = model_name

  @classmethod
  def encode_image(cls, image: np.ndarray) -> str:
    return base64.b64encode(array_to_jpeg_bytes(image)).decode('utf-8')

  def predict(
      self,
      text_prompt: str,
  ) -> tuple[str, Optional[bool], Any]:
    return self.predict_mm(text_prompt, [])

  def predict_mm(
      self, text_prompt: str, images: list[np.ndarray]
  ) -> tuple[str, Optional[bool], Any]:
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {self.openai_api_key}',
    }

    payload = {
        'model': self.model,
        'temperature': self.temperature,
        'messages': [{
            'role': 'user',
            'content': [
                {'type': 'text', 'text': text_prompt},
            ],
        }],
        'max_tokens': 1000,
    }

    # Gpt-4v supports multiple images, just need to insert them in the content
    # list.
    for image in images:
      payload['messages'][0]['content'].append({
          'type': 'image_url',
          'image_url': {
              'url': f'data:image/jpeg;base64,{self.encode_image(image)}'
          },
      })

    counter = self.max_retry
    wait_seconds = self.RETRY_WAITING_SECONDS
    while counter > 0:
      try:
        response = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers=headers,
            json=payload,
        )
        if response.ok and 'choices' in response.json():
          return (
              response.json()['choices'][0]['message']['content'],
              None,
              response,
          )
        print(
            'Error calling OpenAI API with error message: '
            + response.json()['error']['message']
        )
        time.sleep(wait_seconds)
        wait_seconds *= 2
      except Exception as e:  # pylint: disable=broad-exception-caught
        # Want to catch all exceptions happened during LLM calls.
        time.sleep(wait_seconds)
        wait_seconds *= 2
        counter -= 1
        print('Error calling LLM, will retry soon...')
        print(e)
    return ERROR_CALLING_LLM, None, None
