#!/usr/bin/env python3
"""Test Gemini 2.5 Pro agent with Docker-based Android environment.

This script runs 3 tasks using the M3A agent with Gemini 2.5 Pro.

Usage:
  python scripts/test_gemini_agent.py
"""

import json
import time
from typing import Any
import numpy as np
import requests

from android_world.agents import infer
from android_world.env import json_action


class DockerEnvWrapper:
    """Wrapper that makes the Docker HTTP API look like AsyncEnv interface."""

    def __init__(self, base_url: str = "http://localhost:5000"):
        self.base_url = base_url
        self._wait_for_health()

    def _wait_for_health(self, timeout: int = 120):
        """Wait for the Docker container to be healthy."""
        print("Waiting for Docker environment to be ready...")
        start = time.time()
        while time.time() - start < timeout:
            try:
                resp = requests.get(f"{self.base_url}/health", timeout=5)
                if resp.ok:
                    print("Environment is ready!")
                    return
            except requests.exceptions.RequestException:
                pass
            time.sleep(2)
        raise RuntimeError("Docker environment not ready after timeout")

    def reset(self, go_home: bool = True):
        """Reset the environment."""
        resp = requests.post(f"{self.base_url}/reset", params={"go_home": go_home})
        resp.raise_for_status()
        return resp.json()

    def get_state(self, wait_to_stabilize: bool = True):
        """Get current state with screenshot."""
        resp = requests.get(
            f"{self.base_url}/screenshot",
            params={"wait_to_stabilize": wait_to_stabilize}
        )
        resp.raise_for_status()
        pixels = np.array(resp.json()["pixels"], dtype=np.uint8)

        # Return a simple state object
        class State:
            def __init__(self, pixels):
                self.pixels = pixels
                self.ui_elements = []
                self.forest = None

        return State(pixels)

    def execute_action(self, action: json_action.JSONAction):
        """Execute an action."""
        resp = requests.post(
            f"{self.base_url}/execute_action",
            json=json.loads(action.json_str())
        )
        resp.raise_for_status()
        return resp.json()

    def get_task_list(self, max_index: int = 10) -> list[str]:
        """Get available tasks."""
        resp = requests.get(
            f"{self.base_url}/suite/task_list",
            params={"max_index": max_index}
        )
        resp.raise_for_status()
        return resp.json()["task_list"]

    def initialize_task(self, task_type: str, task_idx: int = 0):
        """Initialize a task."""
        resp = requests.post(
            f"{self.base_url}/task/initialize",
            params={"task_type": task_type, "task_idx": task_idx}
        )
        resp.raise_for_status()
        return resp.json()

    def get_task_goal(self, task_type: str, task_idx: int = 0) -> str:
        """Get task goal."""
        resp = requests.get(
            f"{self.base_url}/task/goal",
            params={"task_type": task_type, "task_idx": task_idx}
        )
        resp.raise_for_status()
        return resp.json()["goal"]

    def get_task_score(self, task_type: str, task_idx: int = 0) -> float:
        """Get task score."""
        resp = requests.get(
            f"{self.base_url}/task/score",
            params={"task_type": task_type, "task_idx": task_idx}
        )
        resp.raise_for_status()
        return resp.json()["score"]

    def tear_down_task(self, task_type: str, task_idx: int = 0):
        """Tear down task."""
        resp = requests.post(
            f"{self.base_url}/task/tear_down",
            params={"task_type": task_type, "task_idx": task_idx}
        )
        resp.raise_for_status()
        return resp.json()


def run_task_with_agent(env: DockerEnvWrapper, llm: infer.Gemini25ProWrapper,
                        task_type: str, max_steps: int = 10):
    """Run a single task with the Gemini agent."""
    print(f"\n{'='*60}")
    print(f"TASK: {task_type}")
    print(f"{'='*60}")

    # Initialize task
    try:
        env.initialize_task(task_type, task_idx=0)
        goal = env.get_task_goal(task_type, task_idx=0)
        print(f"Goal: {goal}")
    except Exception as e:
        print(f"Failed to initialize task: {e}")
        return None

    # Reset to home
    env.reset(go_home=True)
    time.sleep(1)

    # Run agent loop
    for step in range(max_steps):
        print(f"\n--- Step {step + 1}/{max_steps} ---")

        # Get screenshot
        state = env.get_state(wait_to_stabilize=True)
        screenshot = state.pixels
        print(f"Screenshot shape: {screenshot.shape}")

        # Ask Gemini what to do
        prompt = f"""You are an Android automation agent. Your goal is: {goal}

Look at the screenshot and decide what action to take next.
The screen resolution is 1080x2400. Provide coordinates within this range.

Reply with a JSON action in one of these formats:
- Click: {{"action_type": "click", "x": <x>, "y": <y>}}
- Type text: {{"action_type": "input_text", "text": "<text>"}}
- Scroll: {{"action_type": "scroll", "direction": "up|down|left|right"}}
- Go back: {{"action_type": "navigate_back"}}
- Go home: {{"action_type": "navigate_home"}}
- Open app: {{"action_type": "open_app", "app_name": "<app name>"}}
- Wait: {{"action_type": "wait"}}
- Task complete: {{"action_type": "status", "goal_status": "complete"}}

IMPORTANT: Only reply with the JSON object, no other text or markdown."""

        try:
            response, is_safe, _ = llm.predict_mm(prompt, [screenshot])
            print(f"Gemini response: {response[:100]}...")

            # Clean response - strip markdown code blocks if present
            clean_response = response.strip()
            if clean_response.startswith("```"):
                # Remove ```json and closing ```
                lines = clean_response.split("\n")
                clean_response = "\n".join(
                    line for line in lines
                    if not line.strip().startswith("```")
                )
            clean_response = clean_response.strip()

            # Parse action
            action_dict = json.loads(clean_response)

            # Check if done
            if action_dict.get("action_type") == "status":
                if action_dict.get("goal_status") == "complete":
                    print("Agent believes task is complete")
                    break

            # Execute action
            action = json_action.JSONAction(**action_dict)
            env.execute_action(action)
            time.sleep(1)

        except json.JSONDecodeError as e:
            print(f"Failed to parse response as JSON: {e}")
            continue
        except Exception as e:
            print(f"Error during step: {e}")
            continue

    # Get final score
    try:
        score = env.get_task_score(task_type, task_idx=0)
        print(f"\nFinal Score: {score}")
        env.tear_down_task(task_type, task_idx=0)
        return score
    except Exception as e:
        print(f"Error getting score: {e}")
        return None


def main():
    print("="*60)
    print("Gemini 2.5 Pro Agent Test")
    print("="*60)

    # Initialize environment wrapper
    env = DockerEnvWrapper()

    # Initialize Gemini 2.5 Pro
    print("\nInitializing Gemini 2.5 Pro...")
    llm = infer.Gemini25ProWrapper()

    # Get task list
    tasks = env.get_task_list(max_index=20)
    print(f"\nAvailable tasks: {tasks[:10]}...")

    # Select 3 simple tasks to test (use tasks from the available list)
    # Prioritize tasks that use built-in Android apps
    preferred_tasks = [
        "ClockStopWatchRunning",      # Start stopwatch (WORKS)
        "ClockTimerEntry",            # Set a timer
        "ContactsNewContactDraft",    # Create contact draft (built-in app)
    ]

    # Filter to tasks that exist, or use first 3 available
    test_tasks = [t for t in preferred_tasks if t in tasks]
    if len(test_tasks) < 3:
        for t in tasks:
            if t not in test_tasks:
                test_tasks.append(t)
            if len(test_tasks) >= 3:
                break
    test_tasks = test_tasks[:3]

    print(f"\nRunning {len(test_tasks)} tasks: {test_tasks}")

    results = {}
    for task in test_tasks:
        score = run_task_with_agent(env, llm, task, max_steps=8)
        results[task] = score
        env.reset(go_home=True)
        time.sleep(2)

    # Summary
    print("\n" + "="*60)
    print("RESULTS SUMMARY")
    print("="*60)
    for task, score in results.items():
        status = "✅" if score == 1.0 else "❌" if score == 0.0 else "⚠️"
        print(f"{status} {task}: {score}")


if __name__ == "__main__":
    main()
