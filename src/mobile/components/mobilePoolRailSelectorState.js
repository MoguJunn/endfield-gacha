export function isSelectionWithinPoolGroup(group, currentPoolId) {
  if (!group || !currentPoolId) {
    return false;
  }

  if (group.groupId === currentPoolId) {
    return true;
  }

  if ((group.pools || []).some((pool) => pool?.id === currentPoolId)) {
    return true;
  }

  return (group.subgroups || []).some(
    (subgroup) =>
      subgroup?.groupId === currentPoolId ||
      (subgroup?.allPools || subgroup?.pools || []).some((pool) => pool?.id === currentPoolId)
  );
}

export function resolvePoolGroupExpanded(group, currentPoolId, expansionOverride) {
  return Boolean(
    group?.disableCollapse || isSelectionWithinPoolGroup(group, currentPoolId) || expansionOverride !== false
  );
}

export default {
  isSelectionWithinPoolGroup,
  resolvePoolGroupExpanded,
};
