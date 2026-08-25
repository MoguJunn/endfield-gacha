export function isPoolSelectorGroupCollapsed({
  group,
  collapsedGroupTypes,
  hasSelectedSubgroup = false,
}) {
  return !group?.disableCollapse
    && collapsedGroupTypes?.has(group?.type)
    && !hasSelectedSubgroup;
}

export default {
  isPoolSelectorGroupCollapsed,
};
