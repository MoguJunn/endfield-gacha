import React from 'react';
import { FlaskConical, LockKeyhole } from 'lucide-react';
import {
  isContributorDemoModeEnabled,
  isContributorDemoUser,
} from '../../dev/contributorDemoMode.js';
import { useContributorDemoSandboxStore } from '../../dev/contributorDemoSandboxStore.js';
import { useAuthStore } from '../../stores/index.js';

export default function ContributorDemoBanner() {
  const catalogSource = useContributorDemoSandboxStore((state) => state.catalogSource);
  const user = useAuthStore((state) => state.user);
  if (!isContributorDemoModeEnabled()) return null;
  const signedIn = isContributorDemoUser(user);
  return (
    <div
      className="border-b border-cyan-300 bg-cyan-50 px-4 py-2 text-cyan-950 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-100"
      data-testid="contributor-demo-banner"
      role="status"
    >
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-xs font-medium sm:justify-between sm:text-left">
        <span className="inline-flex items-center gap-2"><FlaskConical size={15} />贡献者内容沙盒 · {catalogSource === 'production-public-api' ? '正式公开目录' : '仓库真实 fallback'}</span>
        <span className="inline-flex items-center gap-2"><LockKeyhole size={14} />{signedIn ? '本地沙盒管理员已登录；内容可本地编辑，真实写入仍禁用' : '登录页提供本地沙盒管理员账号'}</span>
      </div>
    </div>
  );
}
