/**
 * 角色管理界面
 * 超级管理员专用，用于管理所有角色的 CRUD 操作
 *
 * @version 2.0.0 - 重构版本，使用 hooks 和子组件
 * @date 2026-02-04
 */

import React from 'react';
import { Search, Plus, Edit2, Trash2, RefreshCw, User, Swords, Package, ExternalLink, ImagePlus } from 'lucide-react';
import { useCharacters } from '../../hooks/admin/useCharacters';
import { CharacterTable, CharacterEditDialog, BatchEditDialog, SklandImageImportDialog } from './characters';
import { CURRENT_SYNC_SOURCE_LABEL, SKLAND_CATALOG_URLS } from '../../constants/adminImageSources';
import useSiteConfigStore, { useJsonConfig } from '../../stores/useSiteConfigStore';
import { ENTITY_LOCALIZATION_CONFIG_KEY, localizeEntityName } from '../../utils/gameDataI18n.js';

const EMPTY_LOCALIZATION_CONFIG = {};

/**
 * 角色管理组件
 */
const CharacterManagement = ({ showToast, service = null, configAdapter = null, sandboxMode = false }) => {
  const storedEntityLocalizationConfig = useJsonConfig(ENTITY_LOCALIZATION_CONFIG_KEY, EMPTY_LOCALIZATION_CONFIG);
  const [sandboxLocalizationConfig, setSandboxLocalizationConfig] = React.useState(EMPTY_LOCALIZATION_CONFIG);
  const entityLocalizationConfig = sandboxMode ? sandboxLocalizationConfig : storedEntityLocalizationConfig;
  const [localizedNameEnOverride, setLocalizedNameEnOverride] = React.useState('');
  const {
    // 数据状态
    characters,
    loading,
    actionLoading,
    filteredCharacters,

    // 同步状态
    isSyncing,
    syncProgress,

    // Tab
    activeTab,
    setActiveTab,

    // 批量选择
    selectedIds,
    toggleSelect,
    selectAll,
    deselectAll,
    isAllSelected,

    // 搜索筛选
    searchQuery,
    setSearchQuery,
    rarityFilter,
    setRarityFilter,
    limitedFilter,
    setLimitedFilter,

    // 排序
    sortField,
    sortDirection,
    handleSort,

    // 编辑对话框
    showEditDialog,
    editingCharacter,
    characterForm,
    setCharacterForm,
    handleCharacterIdChange,
    handleCharacterNameChange,
    handleCharacterTypeChange,
    aliasInput,
    setAliasInput,
    resetForm,
    startCreate,
    startEdit,
    addAlias,
    removeAlias,
    saveCharacter,
    deleteCharacter,

    // 批量编辑
    showBatchEditDialog,
    batchEditForm,
    setBatchEditForm,
    openBatchEditDialog,
    closeBatchEditDialog,
    executeBatchEdit,
    handleBatchDelete,
    showSklandImportDialog,
    openSklandImportDialog,
    closeSklandImportDialog,
    sklandImportText,
    setSklandImportText,
    sklandImportPreview,
    copySklandExtractScript,
    applySklandImages,

    // 同步操作
    handleSyncFromAPI
  } = useCharacters({
    showToast,
    service: service || undefined,
    invalidateCache: service ? async () => true : undefined,
    sandboxMode,
  });

  React.useEffect(() => {
    if (!sandboxMode || !configAdapter) return;
    let mounted = true;
    configAdapter.loadItems().then((items) => {
      if (!mounted) return;
      const item = items.find((entry) => entry.key === ENTITY_LOCALIZATION_CONFIG_KEY);
      try {
        setSandboxLocalizationConfig(item?.value ? JSON.parse(item.value) : EMPTY_LOCALIZATION_CONFIG);
      } catch {
        setSandboxLocalizationConfig(EMPTY_LOCALIZATION_CONFIG);
      }
    });
    return () => {
      mounted = false;
    };
  }, [configAdapter, sandboxMode]);

  const getStoredEnglishOverride = React.useCallback((characterLike) => {
    if (!characterLike || !entityLocalizationConfig || typeof entityLocalizationConfig !== 'object') {
      return '';
    }

    const keys = [characterLike.id, characterLike.name].filter(Boolean);
    for (const key of keys) {
      const entry = entityLocalizationConfig[key];
      if (entry && typeof entry === 'object' && typeof entry['en-US'] === 'string') {
        return entry['en-US'].trim();
      }
    }

    return '';
  }, [entityLocalizationConfig]);

  React.useEffect(() => {
    if (!showEditDialog) {
      setLocalizedNameEnOverride('');
      return;
    }

    const currentOverride = getStoredEnglishOverride(editingCharacter);
    setLocalizedNameEnOverride(currentOverride);
  }, [editingCharacter, getStoredEnglishOverride, showEditDialog]);

  const localizedNameEnPreview = React.useMemo(() => {
    const manualValue = localizedNameEnOverride.trim();
    if (manualValue) {
      return manualValue;
    }

    return localizeEntityName(characterForm.name, {
      locale: 'en-US',
      type: characterForm.type
    });
  }, [characterForm.name, characterForm.type, localizedNameEnOverride]);

  const handleSaveCharacterWithLocalization = React.useCallback(async () => {
    const result = await saveCharacter();
    if (!result?.success || !result.characterData) {
      return;
    }

    const nextConfig = {
      ...(entityLocalizationConfig && typeof entityLocalizationConfig === 'object' ? entityLocalizationConfig : {})
    };
    const overrideValue = localizedNameEnOverride.trim();
    delete nextConfig[result.characterData.name];

    if (overrideValue) {
      nextConfig[result.characterData.id] = {
        type: result.characterData.type,
        name: result.characterData.name,
        'zh-CN': result.characterData.name,
        'en-US': overrideValue
      };
    } else {
      delete nextConfig[result.characterData.id];
    }

    const metadata = { label: '角色/武器名称本地化', category: 'content' };
    const success = configAdapter
      ? await configAdapter.updateConfig(ENTITY_LOCALIZATION_CONFIG_KEY, JSON.stringify(nextConfig, null, 2), metadata)
      : await useSiteConfigStore.getState().updateConfig(
        ENTITY_LOCALIZATION_CONFIG_KEY,
        JSON.stringify(nextConfig, null, 2),
        metadata
      );

    if (!success) {
      showToast?.('角色已保存，但英文名本地化覆盖保存失败', 'warning');
    } else if (sandboxMode) {
      setSandboxLocalizationConfig(nextConfig);
    }
  }, [configAdapter, entityLocalizationConfig, localizedNameEnOverride, sandboxMode, saveCharacter, showToast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tab切换：角色/武器 */}
      <div className="flex border-b border-zinc-200 dark:border-zinc-800">
        <button
          onClick={() => setActiveTab('character')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'character'
              ? 'border-red-500 text-red-600 dark:text-red-400'
              : 'border-transparent text-slate-500 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300'
          }`}
        >
          <User size={16} className="inline mr-2" />
          角色 ({characters.filter(c => c.type === 'character').length})
        </button>
        <button
          onClick={() => setActiveTab('weapon')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'weapon'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300'
          }`}
        >
          <Swords size={16} className="inline mr-2" />
          武器 ({characters.filter(c => c.type === 'weapon').length})
        </button>
      </div>

      {/* 工具栏 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`搜索${activeTab === 'character' ? '角色' : '武器'}名称、ID...`}
            className="w-full pl-9 pr-3 py-2 text-sm border border-zinc-300 dark:border-zinc-700 rounded-none bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 focus:ring-2 focus:ring-red-500 outline-none"
          />
        </div>
        <select
          value={rarityFilter}
          onChange={(e) => setRarityFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-zinc-300 dark:border-zinc-700 rounded-none bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300"
        >
          <option value="all">全部稀有度</option>
          <option value="6">6星</option>
          <option value="5">5星</option>
          <option value="4">4星</option>
          <option value="3">3星</option>
        </select>
        <select
          value={limitedFilter}
          onChange={(e) => setLimitedFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-zinc-300 dark:border-zinc-700 rounded-none bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300"
        >
          <option value="all">全部类型</option>
          <option value="limited">限定</option>
          <option value="standard">常驻</option>
        </select>
        <button
          onClick={startCreate}
          className="flex items-center gap-1 px-3 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-none transition-colors"
        >
          <Plus size={16} />
          新增{activeTab === 'character' ? '角色' : '武器'}
        </button>
        {!sandboxMode && <button
          onClick={() => handleSyncFromAPI()}
          disabled={isSyncing}
          className="flex items-center gap-1 px-3 py-2 bg-green-500 hover:bg-green-600 disabled:bg-green-400 text-white text-sm font-medium rounded-none transition-colors"
          title={`从 ${CURRENT_SYNC_SOURCE_LABEL} 同步基础数据并上传当前头像资源到服务器`}
        >
          <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
          {isSyncing ? syncProgress || '同步中...' : '同步数据'}
        </button>}
        {!sandboxMode && <a
          href={SKLAND_CATALOG_URLS.character}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 px-3 py-2 border border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/20 text-sm font-medium rounded-none transition-colors"
          title="打开森空岛终末地 WIKI 角色图鉴"
        >
          <ExternalLink size={16} />
          角色图鉴
        </a>}
        {!sandboxMode && <a
          href={SKLAND_CATALOG_URLS.weapon}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 px-3 py-2 border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-sm font-medium rounded-none transition-colors"
          title="打开森空岛终末地 WIKI 武器图鉴"
        >
          <ExternalLink size={16} />
          武器图鉴
        </a>}
        {!sandboxMode && <button
          onClick={openSklandImportDialog}
          className="flex items-center gap-1 px-3 py-2 border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-sm font-medium rounded-none transition-colors"
          title={`从当前${activeTab === 'weapon' ? '武器' : '角色'}森空岛终末地 WIKI 批量导入图片链接`}
        >
          <ImagePlus size={16} />
          导入图鉴图片
        </button>}
      </div>

      <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 px-3 py-2 text-xs text-slate-500 dark:text-zinc-400">
        {sandboxMode
          ? '本地沙盒可新增、编辑、批量修改和删除角色 / 武器；刷新正式目录与重置入口位于控制台顶部。外部图鉴同步和上传已禁用。'
          : <>当前“同步数据”仍使用 {CURRENT_SYNC_SOURCE_LABEL} 作为基础数据源；`ADMIN-001` 推进阶段优先将角色 / 武器图片维护入口收口到森空岛终末地 WIKI 官方图鉴，自动抓图源待后续继续推进。</>}
      </div>

      {/* 批量操作栏 */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
          <span className="text-sm text-blue-700 dark:text-blue-300 font-medium">
            已选择 {selectedIds.size} 项
          </span>
          <div className="flex-1" />
          <button
            onClick={openBatchEditDialog}
            disabled={actionLoading}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
          >
            <Edit2 size={14} />
            批量编辑
          </button>
          <button
            onClick={handleBatchDelete}
            disabled={actionLoading}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-500 hover:bg-red-600 text-white rounded transition-colors"
          >
            <Trash2 size={14} />
            批量删除
          </button>
          <button
            onClick={deselectAll}
            className="px-3 py-1.5 text-xs bg-slate-500 hover:bg-slate-600 text-white rounded transition-colors"
          >
            取消选择
          </button>
        </div>
      )}

      {/* 统计信息 */}
      <div className="text-xs text-slate-500 dark:text-zinc-500">
        显示 {filteredCharacters.length} / {characters.filter(c => c.type === activeTab).length} 个{activeTab === 'character' ? '角色' : '武器'}
      </div>

      {/* 列表 */}
      {filteredCharacters.length === 0 ? (
        <div className="p-12 text-center text-slate-400 dark:text-zinc-500">
          <Package size={48} className="mx-auto mb-4 opacity-50" />
          <p>{characters.filter(c => c.type === activeTab).length === 0 ? `暂无${activeTab === 'character' ? '角色' : '武器'}` : '未找到匹配项'}</p>
        </div>
      ) : (
        <CharacterTable
          characters={filteredCharacters}
          getEnglishName={(character) => localizeEntityName(character.name, { locale: 'en-US', type: character.type })}
          selectedIds={selectedIds}
          isAllSelected={isAllSelected}
          actionLoading={actionLoading}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
          onToggleSelect={toggleSelect}
          onSelectAll={selectAll}
          onDeselectAll={deselectAll}
          onEdit={startEdit}
          onDelete={deleteCharacter}
        />
      )}

      {/* 编辑对话框 */}
        <CharacterEditDialog
          show={showEditDialog}
          editingCharacter={editingCharacter}
          characterForm={characterForm}
          localizedNameEnOverride={localizedNameEnOverride}
          localizedNameEnPreview={localizedNameEnPreview}
          onLocalizedNameEnChange={setLocalizedNameEnOverride}
          setCharacterForm={setCharacterForm}
          onCharacterIdChange={handleCharacterIdChange}
          onCharacterNameChange={handleCharacterNameChange}
        onCharacterTypeChange={handleCharacterTypeChange}
        aliasInput={aliasInput}
        setAliasInput={setAliasInput}
        actionLoading={actionLoading}
          onSave={handleSaveCharacterWithLocalization}
          onClose={resetForm}
          onAddAlias={addAlias}
          onRemoveAlias={removeAlias}
      />

      {/* 批量编辑对话框 */}
      <BatchEditDialog
        show={showBatchEditDialog}
        selectedCount={selectedIds.size}
        batchEditForm={batchEditForm}
        setBatchEditForm={setBatchEditForm}
        actionLoading={actionLoading}
        onExecute={executeBatchEdit}
        onClose={closeBatchEditDialog}
      />

      {!sandboxMode && <SklandImageImportDialog
        show={showSklandImportDialog}
        itemType={activeTab}
        importText={sklandImportText}
        setImportText={setSklandImportText}
        importPreview={sklandImportPreview}
        actionLoading={actionLoading}
        onClose={closeSklandImportDialog}
        onCopyScript={copySklandExtractScript}
        onImport={applySklandImages}
      />}
    </div>
  );
};

export default CharacterManagement;
