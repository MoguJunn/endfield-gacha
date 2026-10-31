export function resolvePoolGroupExpanded(group, expansionOverride) {
  return group?.disableCollapse || expansionOverride !== false;
}

export default {
  resolvePoolGroupExpanded,
};
