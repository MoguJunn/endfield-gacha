export function isPoolSelectorGroupCollapsed({
  group,
  collapsedGroupTypes,
}) {
  return !group?.disableCollapse
    && collapsedGroupTypes?.has(group?.type);
}

export default {
  isPoolSelectorGroupCollapsed,
};
