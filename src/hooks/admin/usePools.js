/**
 * 卡池管理 Hook
 * 集中管理状态和业务逻辑
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import * as poolService from '../../services/admin/poolService';
import { invalidatePublicCache } from '../../services/admin/publicCacheService';
import { useAuthStore } from '../../stores';
import { characterCache } from '../../utils/characterUtils';

// 表单初始状态
export const INITIAL_POOL_FORM = {
  name: '',
  name_en: '',
  type: 'limited',
  up_character: '',
  featured_characters_text: '',
  banner_url: '',
  description: '',
  start_time: '',
  end_time: '',
  is_limited_weapon: true,
  locked: false,
};

function normalizePoolType(type) {
  if (type === 'limited_character') return 'limited';
  if (type === 'limited_weapon') return 'weapon';
  return type || 'limited';
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeNullableText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeDateInput(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeComparableValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }

  if (value === undefined || value === '') {
    return null;
  }

  return value;
}

function areValuesEqual(left, right) {
  const normalizedLeft = normalizeComparableValue(left);
  const normalizedRight = normalizeComparableValue(right);

  if (Array.isArray(normalizedLeft) || Array.isArray(normalizedRight)) {
    return JSON.stringify(normalizedLeft || []) === JSON.stringify(normalizedRight || []);
  }

  return normalizedLeft === normalizedRight;
}

export function parseFeaturedCharactersInput(value) {
  return Array.from(
    new Set(
      String(value || '')
        .split(/[\n,，、；;|]+/u)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function buildFeaturedCharacterSet(poolType, upCharacter, featuredCharactersInput) {
  const normalizedPoolType = normalizePoolType(poolType);
  if (normalizedPoolType === 'extra') {
    return new Set(parseFeaturedCharactersInput(featuredCharactersInput));
  }

  const normalizedUpCharacter = String(upCharacter || '').trim();
  return normalizedUpCharacter ? new Set([normalizedUpCharacter]) : new Set();
}

function getExpectedCharacterType(poolType) {
  return normalizePoolType(poolType) === 'weapon' ? 'weapon' : 'character';
}

function buildCharacterNameMap(characters = [], expectedType = 'character') {
  const result = new Map();
  (Array.isArray(characters) ? characters : []).forEach((character) => {
    if (character?.type !== expectedType) {
      return;
    }

    const name = String(character.name || '').trim();
    if (name) {
      result.set(name, character);
    }
  });
  return result;
}

export function normalizeDraftPoolCharacters(rows = [], characters = [], poolType, featuredNames = []) {
  const expectedType = getExpectedCharacterType(poolType);
  const validCharactersById = new Map(
    (Array.isArray(characters) ? characters : [])
      .filter((character) => character?.id && character.type === expectedType)
      .map((character) => [character.id, character])
  );
  const validCharactersByName = buildCharacterNameMap(characters, expectedType);
  const featuredNameSet = new Set(featuredNames.map((name) => String(name || '').trim()).filter(Boolean));
  const dedupedRows = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const characterId = String(row?.character_id || '').trim();
    const character = validCharactersById.get(characterId);
    if (!character) {
      return;
    }

    dedupedRows.set(characterId, {
      character_id: characterId,
      is_up: Boolean(row?.is_up) || featuredNameSet.has(character.name),
    });
  });

  featuredNameSet.forEach((name) => {
    const character = validCharactersByName.get(name);
    if (character) {
      dedupedRows.set(character.id, {
        character_id: character.id,
        is_up: true,
      });
    }
  });

  return Array.from(dedupedRows.values());
}

export function buildPoolDataFromForm(poolForm = {}) {
  const normalizedPoolType = normalizePoolType(poolForm.type);
  const featuredCharacters = parseFeaturedCharactersInput(poolForm.featured_characters_text);
  const upCharacterName =
    normalizedPoolType === 'extra' ? featuredCharacters[0] || '' : normalizeText(poolForm.up_character);

  return {
    normalizedPoolType,
    expectedCharacterType: getExpectedCharacterType(normalizedPoolType),
    featuredCharacters,
    upCharacterName,
    poolData: {
      name: normalizeText(poolForm.name),
      name_en: normalizeNullableText(poolForm.name_en),
      type: normalizedPoolType,
      up_character: upCharacterName || null,
      featured_characters: normalizedPoolType === 'extra' ? featuredCharacters : null,
      banner_url: normalizeNullableText(poolForm.banner_url),
      description: normalizeNullableText(poolForm.description),
      start_time: normalizeDateInput(poolForm.start_time),
      end_time: normalizeDateInput(poolForm.end_time),
      is_limited_weapon: normalizedPoolType === 'weapon' ? Boolean(poolForm.is_limited_weapon) : null,
      locked: Boolean(poolForm.locked),
    },
  };
}

function getCharacterLabel(characterId, characterMap) {
  const character = characterMap.get(characterId);
  return character?.name || characterId;
}

function buildRosterDiff(currentRows = [], originalRows = [], characters = []) {
  const characterMap = new Map(
    (Array.isArray(characters) ? characters : [])
      .filter((character) => character?.id)
      .map((character) => [character.id, character])
  );
  const currentMap = new Map(
    (Array.isArray(currentRows) ? currentRows : [])
      .filter((row) => row?.character_id)
      .map((row) => [row.character_id, Boolean(row.is_up)])
  );
  const originalMap = new Map(
    (Array.isArray(originalRows) ? originalRows : [])
      .filter((row) => row?.character_id)
      .map((row) => [row.character_id, Boolean(row.is_up)])
  );

  const added = [];
  const removed = [];
  const upChanged = [];

  currentMap.forEach((isUp, characterId) => {
    if (!originalMap.has(characterId)) {
      added.push({
        id: characterId,
        name: getCharacterLabel(characterId, characterMap),
        is_up: isUp,
      });
      return;
    }

    if (originalMap.get(characterId) !== isUp) {
      upChanged.push({
        id: characterId,
        name: getCharacterLabel(characterId, characterMap),
        before: originalMap.get(characterId),
        after: isUp,
      });
    }
  });

  originalMap.forEach((isUp, characterId) => {
    if (!currentMap.has(characterId)) {
      removed.push({
        id: characterId,
        name: getCharacterLabel(characterId, characterMap),
        is_up: isUp,
      });
    }
  });

  return {
    added,
    removed,
    upChanged,
    currentCount: currentMap.size,
    originalCount: originalMap.size,
    changed: added.length > 0 || removed.length > 0 || upChanged.length > 0,
  };
}

export function buildPoolDraftDiff({
  editingPool = null,
  poolForm = INITIAL_POOL_FORM,
  editingPoolCharacters = [],
  originalPoolCharacters = [],
  characters = [],
} = {}) {
  const { normalizedPoolType, featuredCharacters, upCharacterName, poolData } = buildPoolDataFromForm(poolForm);
  const featuredNamesForSave = normalizedPoolType === 'extra' ? featuredCharacters : [upCharacterName].filter(Boolean);
  const normalizedCurrentRows = normalizeDraftPoolCharacters(
    editingPoolCharacters,
    characters,
    normalizedPoolType,
    featuredNamesForSave
  );
  const normalizedOriginalRows = editingPool
    ? normalizeDraftPoolCharacters(
        originalPoolCharacters,
        characters,
        normalizePoolType(editingPool.type),
        Array.isArray(editingPool.featured_characters)
          ? editingPool.featured_characters
          : [editingPool.up_character].filter(Boolean)
      )
    : [];

  const fieldLabels = {
    name: '卡池名称',
    name_en: '英文名称',
    type: '卡池类型',
    up_character: 'UP 项',
    featured_characters: '附加寻访 6★',
    banner_url: 'Banner',
    description: '描述',
    start_time: '开始时间',
    end_time: '结束时间',
    is_limited_weapon: '限定武器',
  };
  const fieldChanges = [];

  if (editingPool) {
    Object.entries(fieldLabels).forEach(([key, label]) => {
      if (!areValuesEqual(editingPool[key], poolData[key])) {
        fieldChanges.push({
          key,
          label,
          before: normalizeComparableValue(editingPool[key]),
          after: normalizeComparableValue(poolData[key]),
        });
      }
    });
  } else {
    ['name', 'type', 'up_character', 'featured_characters', 'start_time', 'end_time'].forEach((key) => {
      const value = normalizeComparableValue(poolData[key]);
      if (value !== null && !(Array.isArray(value) && value.length === 0)) {
        fieldChanges.push({
          key,
          label: fieldLabels[key],
          before: null,
          after: value,
        });
      }
    });
  }

  const roster = buildRosterDiff(normalizedCurrentRows, normalizedOriginalRows, characters);

  return {
    mode: editingPool ? 'edit' : 'create',
    fieldChanges,
    roster,
    normalizedPoolType,
    poolData,
    currentRows: normalizedCurrentRows,
    hasChanges: !editingPool || fieldChanges.length > 0 || roster.changed,
  };
}

/**
 * 卡池管理主 Hook
 */
export const usePools = (showToast) => {
  const userRole = useAuthStore((state) => state.userRole);

  // 数据状态
  const [pools, setPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

  // 角色数据状态
  const [characters, setCharacters] = useState([]);

  // 池子-角色关联数据
  const [poolCharacters, setPoolCharacters] = useState({});
  const [editingPoolCharacters, setEditingPoolCharacters] = useState([]);
  const [editingPoolOriginalCharacters, setEditingPoolOriginalCharacters] = useState([]);

  // 搜索和筛选状态
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortField, setSortField] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');

  // 编辑对话框状态
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingPool, setEditingPool] = useState(null);
  const [poolForm, setPoolForm] = useState(INITIAL_POOL_FORM);

  const ensureSuperAdmin = useCallback(() => {
    if (userRole !== 'super_admin') {
      showToast('只有超级管理员可以执行该操作', 'error');
      return false;
    }
    return true;
  }, [showToast, userRole]);

  // 加载数据
  const loadPoolsData = useCallback(async () => {
    setLoading(true);
    const result = await poolService.loadPools();
    if (result.success) {
      setPools(result.data);
    } else {
      showToast('加载卡池失败: ' + result.error, 'error');
    }
    setLoading(false);
  }, [showToast]);

  const loadCharactersData = useCallback(async () => {
    const result = await poolService.loadCharacters();
    if (result.success) {
      setCharacters(result.data);
    }
  }, []);

  const loadAllPoolCharactersData = useCallback(async () => {
    const result = await poolService.loadAllPoolCharacters();
    if (result.success) {
      setPoolCharacters(result.data);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    loadPoolsData();
    loadCharactersData();
    loadAllPoolCharactersData();
  }, [loadPoolsData, loadCharactersData, loadAllPoolCharactersData]);

  // 过滤并排序后的卡池列表
  const filteredPools = useMemo(() => {
    const result = pools.filter((pool) => {
      const matchesSearch =
        pool.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pool.up_character?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (Array.isArray(pool.featured_characters) &&
          pool.featured_characters.some((name) => name?.toLowerCase().includes(searchQuery.toLowerCase())));
      const matchesType = typeFilter === 'all' || pool.type === typeFilter;
      return matchesSearch && matchesType;
    });

    result.sort((a, b) => {
      let aVal, bVal;
      switch (sortField) {
        case 'start_time':
          aVal = a.start_time ? new Date(a.start_time).getTime() : 0;
          bVal = b.start_time ? new Date(b.start_time).getTime() : 0;
          break;
        case 'end_time':
          aVal = a.end_time ? new Date(a.end_time).getTime() : 0;
          bVal = b.end_time ? new Date(b.end_time).getTime() : 0;
          break;
        case 'name':
          aVal = a.name || '';
          bVal = b.name || '';
          return sortOrder === 'asc' ? aVal.localeCompare(bVal, 'zh-CN') : bVal.localeCompare(aVal, 'zh-CN');
        default:
          aVal = a.created_at ? new Date(a.created_at).getTime() : 0;
          bVal = b.created_at ? new Date(b.created_at).getTime() : 0;
      }
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return result;
  }, [pools, searchQuery, typeFilter, sortField, sortOrder]);

  // 检查UP角色/武器是否存在
  const checkUpCharacterExists = useCallback(
    (upCharacterName, expectedType = null) => {
      if (!upCharacterName || !upCharacterName.trim()) return true;
      return characters.some((c) => c.name === upCharacterName.trim() && (!expectedType || c.type === expectedType));
    },
    [characters]
  );

  // 重置表单
  const resetForm = useCallback(() => {
    setPoolForm(INITIAL_POOL_FORM);
    setEditingPool(null);
    setEditingPoolCharacters([]);
    setEditingPoolOriginalCharacters([]);
    setShowEditDialog(false);
  }, []);

  // 开始编辑
  const startEdit = useCallback(async (pool) => {
    const formatDateTimeLocal = (utcDateString) => {
      if (!utcDateString) return '';
      const date = new Date(utcDateString);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    };

    const result = await poolService.loadPoolCharactersForEdit(pool.pool_id);
    setEditingPoolCharacters(result.data);
    setEditingPoolOriginalCharacters(result.data);

    setPoolForm({
      name: pool.name || '',
      name_en: pool.name_en || '',
      type: pool.type || 'limited',
      up_character: pool.up_character || '',
      featured_characters_text: Array.isArray(pool.featured_characters)
        ? pool.featured_characters.filter(Boolean).join('\n')
        : '',
      banner_url: pool.banner_url || '',
      description: pool.description || '',
      start_time: formatDateTimeLocal(pool.start_time),
      end_time: formatDateTimeLocal(pool.end_time),
      is_limited_weapon: pool.is_limited_weapon !== false,
      locked: pool.locked || false,
    });
    setEditingPool(pool);
    setShowEditDialog(true);
  }, []);

  const startCreate = useCallback(() => {
    setPoolForm(INITIAL_POOL_FORM);
    setEditingPool(null);
    setEditingPoolCharacters([]);
    setEditingPoolOriginalCharacters([]);
    setShowEditDialog(true);
  }, []);

  const poolDraftDiff = useMemo(
    () =>
      buildPoolDraftDiff({
        editingPool,
        poolForm,
        editingPoolCharacters,
        originalPoolCharacters: editingPoolOriginalCharacters,
        characters,
      }),
    [editingPool, poolForm, editingPoolCharacters, editingPoolOriginalCharacters, characters]
  );

  // 保存卡池
  const handleSavePool = useCallback(async () => {
    if (!ensureSuperAdmin()) return null;

    if (!poolForm.name.trim()) {
      showToast('卡池名称不能为空', 'error');
      return null;
    }

    setActionLoading('save');

    try {
      const { normalizedPoolType, expectedCharacterType, featuredCharacters, upCharacterName } =
        buildPoolDataFromForm(poolForm);

      if (normalizedPoolType === 'extra') {
        if (featuredCharacters.length !== 4) {
          showToast('附加寻访必须填写 4 个不重复的 6★ 角色名称', 'error');
          setActionLoading(null);
          return;
        }

        const missingFeaturedCharacters = featuredCharacters.filter(
          (name) => !checkUpCharacterExists(name, 'character')
        );
        if (missingFeaturedCharacters.length > 0) {
          showToast(`以下角色不存在，无法创建附加寻访：${missingFeaturedCharacters.join('、')}`, 'error');
          setActionLoading(null);
          return;
        }
      }

      let charactersForSave = characters;
      let editingPoolCharactersForSave = editingPoolCharacters;
      const featuredNamesForSave =
        normalizedPoolType === 'extra' ? featuredCharacters : [upCharacterName].filter(Boolean);

      // 检查UP角色是否存在
      if (upCharacterName && (normalizedPoolType === 'limited' || normalizedPoolType === 'weapon')) {
        const upExists = checkUpCharacterExists(upCharacterName, expectedCharacterType);

        if (!upExists) {
          try {
            const poolStartTime = poolForm.start_time
              ? new Date(poolForm.start_time).toISOString()
              : new Date().toISOString();
            const createdCharacter = await poolService.createUpCharacter(
              upCharacterName,
              normalizedPoolType,
              poolStartTime
            );
            charactersForSave = [...characters, createdCharacter];
            if (!editingPoolCharactersForSave.some((row) => row.character_id === createdCharacter.id)) {
              editingPoolCharactersForSave = [
                ...editingPoolCharactersForSave,
                { character_id: createdCharacter.id, is_up: true },
              ];
            }
            showToast(`已自动创建UP角色「${upCharacterName}」并加入本次卡池草稿`, 'success');
            await loadCharactersData();
            await characterCache.refresh();
            await invalidatePublicCache('characters', 'admin:pool:create-up-character');
          } catch (createError) {
            showToast('创建UP角色失败: ' + createError.message, 'error');
            setActionLoading(null);
            return;
          }
        }
      }

      editingPoolCharactersForSave = normalizeDraftPoolCharacters(
        editingPoolCharactersForSave,
        charactersForSave,
        normalizedPoolType,
        featuredNamesForSave
      );

      const { poolData } = buildPoolDataFromForm(poolForm);

      const result = await poolService.savePool(poolData, editingPool, charactersForSave, editingPoolCharactersForSave);

      if (result.success) {
        if (result.isNew) {
          showToast(`卡池已创建，已保存 ${result.addedCount} 个池中项目`, 'success');
        } else {
          showToast(`卡池已更新，已保存 ${result.addedCount} 个池中项目`, 'success');
        }
        await loadPoolsData();
        await loadAllPoolCharactersData();
        await invalidatePublicCache('pools', 'admin:pool:save');
        const savedPool = {
          ...poolData,
          pool_id: result.poolId || poolData.pool_id || editingPool?.pool_id,
        };
        resetForm();
        return { ...result, pool: savedPool };
      } else {
        showToast('保存失败: ' + result.error, 'error');
        return result;
      }
    } finally {
      setActionLoading(null);
    }
  }, [
    poolForm,
    editingPool,
    editingPoolCharacters,
    characters,
    checkUpCharacterExists,
    ensureSuperAdmin,
    showToast,
    loadPoolsData,
    loadCharactersData,
    loadAllPoolCharactersData,
    resetForm,
  ]);

  // 删除卡池
  const handleDeletePool = useCallback(
    async (pool) => {
      if (!ensureSuperAdmin()) return;

      if (!window.confirm(`确定要删除卡池「${pool.name}」吗？此操作将删除该卡池的所有相关数据，且无法撤销。`)) {
        return;
      }

      setActionLoading(pool.pool_id);

      const result = await poolService.deletePool(pool.pool_id);
      if (result.success) {
        showToast('卡池已删除', 'success');
        await loadPoolsData();
        await invalidatePublicCache('pools', 'admin:pool:delete');
      } else {
        showToast('删除失败: ' + result.error, 'error');
      }

      setActionLoading(null);
    },
    [ensureSuperAdmin, showToast, loadPoolsData]
  );

  // 重新计算限定/常驻
  const handleRecalculateIsStandard = useCallback(async () => {
    if (!ensureSuperAdmin()) return;

    setActionLoading('recalculate');

    const result = await poolService.recalculateIsStandard(pools);
    if (result.success) {
      if (result.changedCount === 0) {
        showToast(result.message || '所有记录已是最新状态，无需更新', 'info');
      } else {
        await invalidatePublicCache('stats', 'admin:pool:recalculate-is-standard');
        showToast(`已更新 ${result.changedCount} 条记录的限定/常驻状态。刷新页面后生效。`, 'success');
      }
    } else {
      showToast('重新计算失败: ' + result.error, 'error');
    }

    setActionLoading(null);
  }, [ensureSuperAdmin, pools, showToast]);

  // 角色池子管理操作
  const toggleCharacterInPool = useCallback(
    (char, isInPool) => {
      if (!ensureSuperAdmin()) return;

      const featuredCharacterSet = buildFeaturedCharacterSet(
        poolForm.type,
        poolForm.up_character,
        poolForm.featured_characters_text
      );
      const isUp = featuredCharacterSet.has(char.name);
      setEditingPoolCharacters((prev) =>
        isInPool ? prev.filter((pc) => pc.character_id !== char.id) : [...prev, { character_id: char.id, is_up: isUp }]
      );
    },
    [ensureSuperAdmin, poolForm.featured_characters_text, poolForm.type, poolForm.up_character]
  );

  const addAllCharactersToPool = useCallback(
    (charList) => {
      if (!ensureSuperAdmin()) return;

      const currentIds = editingPoolCharacters.map((pc) => pc.character_id);
      const toAdd = charList.filter((c) => !currentIds.includes(c.id));

      if (toAdd.length === 0) {
        showToast('所有角色已在池中', 'info');
        return;
      }

      const featuredCharacterSet = buildFeaturedCharacterSet(
        poolForm.type,
        poolForm.up_character,
        poolForm.featured_characters_text
      );
      setEditingPoolCharacters((prev) => [
        ...prev,
        ...toAdd.map((c) => ({ character_id: c.id, is_up: featuredCharacterSet.has(c.name) })),
      ]);
    },
    [
      ensureSuperAdmin,
      editingPoolCharacters,
      poolForm.featured_characters_text,
      poolForm.type,
      poolForm.up_character,
      showToast,
    ]
  );

  const removeAllCharactersFromPool = useCallback(
    (charList) => {
      if (!ensureSuperAdmin()) return;

      const currentIds = editingPoolCharacters.map((pc) => pc.character_id);
      const toRemove = charList.filter((c) => currentIds.includes(c.id));

      if (toRemove.length === 0) {
        showToast('没有角色需要移除', 'info');
        return;
      }

      const removeIds = toRemove.map((c) => c.id);
      setEditingPoolCharacters((prev) => prev.filter((pc) => !removeIds.includes(pc.character_id)));
    },
    [ensureSuperAdmin, editingPoolCharacters, showToast]
  );

  return {
    // 数据
    pools,
    characters,
    poolCharacters,
    filteredPools,

    // 状态
    loading,
    actionLoading,

    // 搜索筛选排序
    searchQuery,
    setSearchQuery,
    typeFilter,
    setTypeFilter,
    sortField,
    setSortField,
    sortOrder,
    setSortOrder,

    // 编辑对话框
    showEditDialog,
    setShowEditDialog,
    editingPool,
    poolForm,
    setPoolForm,
    editingPoolCharacters,
    poolDraftDiff,

    // 操作
    checkUpCharacterExists,
    resetForm,
    startCreate,
    startEdit,
    handleSavePool,
    handleDeletePool,
    handleRecalculateIsStandard,

    // 角色池子管理
    toggleCharacterInPool,
    addAllCharactersToPool,
    removeAllCharactersFromPool,
  };
};

export default usePools;
