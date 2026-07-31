import React from 'react';
import { Gift, ShieldCheck } from 'lucide-react';
import SummerLotteryContactPanel from './panels/SummerLotteryContactPanel.jsx';

export default function SummerLotteryOperatorPage({ showToast }) {
  return (
    <div className="animate-fade-in space-y-4">
      <div className="border border-indigo-300 bg-indigo-50 p-5 dark:border-indigo-900 dark:bg-indigo-950/20">
        <div className="flex items-start gap-3">
          <Gift size={22} className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-300" />
          <div>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white">抽奖兑奖工作台</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              此页面只提供当前活动中奖联系方式的单条读取与受控删除，不开放用户管理、站点配置或开奖权限。
            </p>
            <p className="mt-2 flex items-center gap-1 text-xs text-indigo-700 dark:text-indigo-300">
              <ShieldCheck size={13} /> 所有权限按活动显式授予，读取与删除均由数据库再次校验并记录 actor。
            </p>
          </div>
        </div>
      </div>
      <SummerLotteryContactPanel
        showToast={showToast}
        showOperationControls={false}
      />
    </div>
  );
}
