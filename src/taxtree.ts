import type { Page } from 'playwright-core';
import type { EnhancedSnapshot, RefMap } from './snapshot.js';

interface DualModeNode {
  core: {
    nodeId: number;
    backendNodeId: number;
    childrenIds?: number[];
    parentId?: number;
    className?: string;
    text?: string;
    contentDescription?: string;
    bounds: {
      left: number;
      top: number;
      right: number;
      bottom: number;
    };
    clickable: boolean;
    longClickable: boolean;
    scrollable: boolean;
    focusable: boolean;
    editable: boolean;
    checkable: boolean;
    enabled: boolean;
    focused: boolean;
    selected: boolean;
    checked: boolean;
    visible: boolean;
  };
  designMode?: {
    visual?: {
      backgroundColor?: string;
      foregroundColor?: string;
      opacity?: number;
      fontSize?: number;
      fontWeight?: number;
    };
    layout?: {
      zIndex?: number;
      isFixedPosition?: boolean;
      isSticky?: boolean;
    };
    spatial?: {
      distanceFromViewportTop?: number;
      isAboveFold?: boolean;
      visualProminenceScore?: number;
    };
  };
  xrayMode?: {
    semantics?: {
      role?: string;
      name?: string;
      description?: string;
      intentTags?: string[];
      importanceScore?: number;
    };
    interaction?: {
      enabled?: boolean;
      selected?: boolean;
      checked?: boolean;
      expanded?: boolean;
      focused?: boolean;
      availableActions?: string[];
      affordanceScore?: number;
    };
  };
  children?: DualModeNode[];
}

interface AXNode {
  nodeId: string;
  role?: { value: string };
  name?: { value: string };
  childIds?: string[];
  parentId?: string;
}

type HydratedAXNode = AXNode & { children: HydratedAXNode[] };

export async function getDualModeSnapshot(
  page: Page,
  options: { interactive?: boolean } = {}
): Promise<EnhancedSnapshot> {
  const session = await page.context().newCDPSession(page);
  let nodes: any[] = [];
  let isDualMode = false;

  try {
    const result = (await session.send('Accessibility.getDualModeAXTree' as any)) as any;
    nodes = result.nodes;
    isDualMode = true;
  } catch (e) {
    try {
      const result = (await session.send('Accessibility.getFullAXTree')) as any;
      nodes = result.nodes;
    } catch (e2) {
      console.warn('Failed to fetch AXTree via CDP:', e2);
      return { tree: '(accessibility tree unavailable)', refs: {} };
    }
  } finally {
    await session.detach();
  }

  const refs: RefMap = {};
  let tree = '';

  resetRefs();

  if (isDualMode) {
    const rootNodes = buildTreeFromFlatNodes(nodes);
    tree = processDualModeTree(rootNodes, refs, options.interactive ?? false);
  } else {
    const rootNodes = buildStandardTree(nodes);
    tree = processStandardTree(rootNodes, refs, options.interactive ?? false);
  }

  return { tree, refs };
}

function buildTreeFromFlatNodes(nodes: DualModeNode[]): DualModeNode[] {
  const nodeMap = new Map<number, DualModeNode>();
  nodes.forEach((n) => nodeMap.set(n.core.nodeId, n));

  const roots: DualModeNode[] = [];

  nodes.forEach((node) => {
    if (node.core.childrenIds) {
      node.children = node.core.childrenIds
        .map((id) => nodeMap.get(id))
        .filter((n): n is DualModeNode => !!n);
    }

    const parentId = node.core.parentId;
    if (parentId === undefined || !nodeMap.has(parentId)) {
      roots.push(node);
    }
  });

  return roots;
}

function buildStandardTree(nodes: AXNode[]): HydratedAXNode[] {
  const nodeMap = new Map<string, HydratedAXNode>();
  // Initialize with empty children array
  nodes.forEach((n) => nodeMap.set(n.nodeId, { ...n, children: [] } as HydratedAXNode));

  const roots: HydratedAXNode[] = [];
  const childrenIdsSet = new Set<string>();

  nodes.forEach((node) => {
    if (node.childIds) {
      const parent = nodeMap.get(node.nodeId);
      if (parent) {
        node.childIds.forEach((childId) => {
          const child = nodeMap.get(childId);
          if (child) {
            parent.children.push(child);
            childrenIdsSet.add(childId);
          }
        });
      }
    }
  });

  nodes.forEach((node) => {
    if (!childrenIdsSet.has(node.nodeId)) {
      const root = nodeMap.get(node.nodeId);
      if (root) roots.push(root);
    }
  });

  return roots;
}

let refCounter = 0;
function resetRefs(): void {
  refCounter = 0;
}
function nextRef(): string {
  return `e${++refCounter}`;
}

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'menuitem',
  'option',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'treeitem',
]);

function processDualModeTree(
  nodes: DualModeNode[],
  refs: RefMap,
  interactiveOnly: boolean = false,
  depth: number = 0
): string {
  const lines: string[] = [];

  for (const node of nodes) {
    const core = node.core;
    if (!core.visible) continue;

    const semantics = node.xrayMode?.semantics || {};
    const interaction = node.xrayMode?.interaction || {};
    const design = node.designMode || {};

    const role = (semantics.role || core.className || 'unknown').toLowerCase();
    let name = semantics.name || core.text || core.contentDescription || '';
    name = name.replace(/\s+/g, ' ').trim();

    // Smart Merge: Use child text if name is empty
    if (name === '' && node.children && node.children.length > 0) {
      const textChild = node.children.find((c) => c.core.className === '#text.StaticText');
      if (textChild) {
        name = (textChild.core.text || '').trim();
      }
    }

    const isInteractive =
      core.clickable ||
      INTERACTIVE_ROLES.has(role) ||
      semantics.intentTags?.includes('interactive');

    if (interactiveOnly && !isInteractive && (!node.children || node.children.length === 0)) {
      continue;
    }

    let line = `${'  '.repeat(depth)}- ${role}`;
    if (name) line += ` "${name.replace(/"/g, '\\"')}"`;

    if (isInteractive || (name && !['unknown', 'generic', 'group'].includes(role))) {
      const ref = nextRef();
      line += ` [ref=${ref}]`;

      const safeNameDouble = name.replace(/"/g, '\\"');
      let selector = '';
      if (['button', 'link', 'textbox', 'checkbox', 'radio'].includes(role)) {
        if (name) selector = `getByRole('${role}', { name: "${safeNameDouble}" })`;
        else selector = `getByRole('${role}')`;
      } else if (name) {
        selector = `getByText("${safeNameDouble}")`;
      } else {
        selector = `locator('.${core.className || role}')`;
      }

      refs[ref] = {
        selector,
        role,
        name,
        bounds: core.bounds,
        nodeId: core.nodeId,
      };
    }

    // --- FULL METADATA OUTPUT ---

    // 1. Core Info (filtered to interesting flags)
    const coreInfo: Record<string, boolean> = {};
    if (core.clickable) coreInfo.clickable = true;
    if (core.longClickable) coreInfo.longClickable = true;
    if (core.scrollable) coreInfo.scrollable = true;
    if (core.focusable) coreInfo.focusable = true;
    if (core.editable) coreInfo.editable = true;
    if (core.checkable) coreInfo.checkable = true;
    if (core.checked) coreInfo.checked = true;
    if (core.selected) coreInfo.selected = true;
    if (core.focused) coreInfo.focused = true;
    if (!core.enabled) coreInfo.disabled = true;

    // 2. Xray Info (semantics + interaction)
    const xrayInfo: any = {};
    if (semantics.importanceScore) xrayInfo.importance = semantics.importanceScore;
    if (semantics.intentTags?.length) xrayInfo.intent = semantics.intentTags;
    if (interaction.availableActions?.length) xrayInfo.actions = interaction.availableActions;
    if (interaction.affordanceScore) xrayInfo.affordance = interaction.affordanceScore;

    // 3. Design Info (visual + layout + spatial)
    // Only include if non-default/interesting
    const designInfo: any = {};
    if (design.visual) {
      if (design.visual.backgroundColor) designInfo.bg = design.visual.backgroundColor;
      if (design.visual.foregroundColor) designInfo.fg = design.visual.foregroundColor;
      if (design.visual.fontSize) designInfo.fontSize = design.visual.fontSize;
      if (design.visual.fontWeight && design.visual.fontWeight !== 400)
        designInfo.weight = design.visual.fontWeight;
      if (design.visual.opacity !== 1) designInfo.opacity = design.visual.opacity;
    }
    if (design.layout) {
      if (design.layout.zIndex !== 0) designInfo.zIndex = design.layout.zIndex;
      if (design.layout.isFixedPosition) designInfo.fixed = true;
      if (design.layout.isSticky) designInfo.sticky = true;
    }
    if (design.spatial) {
      if (!design.spatial.isAboveFold) designInfo.belowFold = true;
      if (design.spatial.visualProminenceScore)
        designInfo.prominence = design.spatial.visualProminenceScore;
    }

    // Append JSON objects to line, indented
    const indent = '  '.repeat(depth + 1);

    if (Object.keys(coreInfo).length > 0) {
      line += `\n${indent}core: ${JSON.stringify(coreInfo)}`;
    }
    if (Object.keys(xrayInfo).length > 0) {
      line += `\n${indent}xray: ${JSON.stringify(xrayInfo)}`;
    }
    if (Object.keys(designInfo).length > 0) {
      line += `\n${indent}design: ${JSON.stringify(designInfo)}`;
    }

    lines.push(line);

    if (node.children) {
      const filteredChildren = node.children.filter((c) => c.core.className !== '#text.StaticText');
      if (filteredChildren.length > 0) {
        const childrenStr = processDualModeTree(filteredChildren, refs, interactiveOnly, depth + 1);
        if (childrenStr) lines.push(childrenStr);
      }
    }
  }

  return lines.join('\n');
}

function processStandardTree(
  nodes: HydratedAXNode[],
  refs: RefMap,
  interactiveOnly: boolean,
  depth: number = 0
): string {
  const lines: string[] = [];

  for (const node of nodes) {
    const role = (node.role?.value || 'unknown').toLowerCase();
    let name = node.name?.value || '';
    name = name.replace(/\s+/g, ' ').trim();

    const isInteractive = INTERACTIVE_ROLES.has(role);

    let line = `${'  '.repeat(depth)}- ${role}`;
    if (name) {
      line += ` "${name.replace(/"/g, '\\"')}"`;
    }

    if (isInteractive || (name && role !== 'unknown')) {
      const ref = nextRef();
      line += ` [ref=${ref}]`;

      const safeNameDouble = name.replace(/"/g, '\\"');
      let selector = '';
      if (isInteractive) {
        if (name) selector = `getByRole('${role}', { name: "${safeNameDouble}" })`;
        else selector = `getByRole('${role}')`;
      } else if (name) {
        selector = `getByText("${safeNameDouble}")`;
      } else {
        selector = `locator('${role}')`;
      }

      refs[ref] = {
        selector: selector,
        role: role,
        name: name,
      };
    }

    lines.push(line);

    if (node.children && node.children.length > 0) {
      const childrenTree = processStandardTree(node.children, refs, interactiveOnly, depth + 1);
      if (childrenTree) lines.push(childrenTree);
    }
  }

  return lines.join('\n');
}
