import React from 'react';
import { AlertTriangle, Clipboard, RefreshCw, RotateCcw } from 'lucide-react';
import appLogger from '../utils/appLogger.js';
import { isModuleLoadError, recoverModuleLoad, reloadModulePage } from '../utils/moduleLoadRecovery.js';
import { buildCrashDiagnostic, isLikelyFatalRuntimeError } from '../utils/appCrashFallback.js';

const isDev = import.meta.env.DEV;

/**
 * React Error Boundary 组件
 * 捕获子组件中的 JavaScript 错误，防止整个应用崩溃
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    // 更新 state 使下一次渲染显示降级 UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    appLogger.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
    recoverModuleLoad(error);
  }

  handleReset = () => {
    if (isModuleLoadError(this.state.error)) {
      this.handleReload();
      return;
    }
    this.setState({ hasError: false, error: null, errorInfo: null, copied: false });
  };

  handleReload = () => {
    if (isModuleLoadError(this.state.error)) reloadModulePage();
    else window.location.reload();
  };

  handleCopyDiagnostic = async () => {
    const diagnostic = {
      ...buildCrashDiagnostic(this.state.error, { phase: 'react-boundary' }),
      componentStack: this.state.errorInfo?.componentStack || null,
    };
    const payload = JSON.stringify(diagnostic, null, 2);

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(payload);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = payload;
      textarea.setAttribute('readonly', 'true');
      textarea.style.cssText = 'position: fixed; left: -9999px; top: -9999px;';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }

    this.setState({ copied: true });
    window.setTimeout(() => this.setState({ copied: false }), 1600);
  };

  render() {
    if (this.state.hasError) {
      const diagnostic = buildCrashDiagnostic(this.state.error, { phase: 'react-boundary' });
      const likelyFatal = isLikelyFatalRuntimeError(this.state.error);
      const moduleLoadFailed = isModuleLoadError(this.state.error);

      return (
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-yellow-500/35 rounded-none p-8 max-w-3xl w-full">
            {/* 图标 */}
            <div className="w-16 h-16 bg-red-500/10 rounded-sm flex items-center justify-center mb-6">
              <AlertTriangle size={32} className="text-red-500" />
            </div>

            {/* 标题 */}
            <h1 className="text-xl font-bold text-zinc-100 mb-2">
              {moduleLoadFailed ? '页面资源加载失败' : likelyFatal ? '页面渲染被阻断' : '应用发生错误'}
            </h1>
            <p className="text-zinc-500 text-sm mb-6">
              {moduleLoadFailed
                ? '页面所需的代码未能加载，可能与网络中断或版本更新有关。请确认网络后刷新页面；已保存的抽卡记录不会被清除。'
                : '当前页面遇到了会影响渲染的异常。下面是诊断信息；如果错误来自旧构建资源，请先尝试刷新页面。'}
            </p>

            <dl className="bg-zinc-950 border border-zinc-800 rounded-none p-4 mb-6 grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-left text-xs">
              <dt className="text-zinc-600 font-bold">错误信息</dt>
              <dd className="text-red-300 font-mono break-all m-0">{diagnostic.message}</dd>
              <dt className="text-zinc-600 font-bold">页面路径</dt>
              <dd className="text-zinc-300 break-all m-0">{diagnostic.route}</dd>
              <dt className="text-zinc-600 font-bold">来源文件</dt>
              <dd className="text-zinc-300 break-all m-0">{diagnostic.filename || '未提供'}</dd>
              <dt className="text-zinc-600 font-bold">版本信息</dt>
              <dd className="text-zinc-300 m-0">
                {diagnostic.appVersion} / {diagnostic.buildInfo}
              </dd>
              <dt className="text-zinc-600 font-bold">发生时间</dt>
              <dd className="text-zinc-300 m-0">{diagnostic.generatedAt}</dd>
            </dl>

            {isDev && this.state.errorInfo && (
              <pre className="bg-zinc-950 border border-zinc-800 text-zinc-500 text-xs p-4 mb-6 overflow-auto max-h-48 whitespace-pre-wrap">
                {this.state.errorInfo.componentStack}
              </pre>
            )}

            {/* 操作按钮 */}
            <div className="flex flex-wrap gap-3">
              {!moduleLoadFailed && (
                <button
                  onClick={this.handleReset}
                  className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 border border-zinc-700 rounded-none transition-colors flex items-center gap-2"
                >
                  <RotateCcw size={16} />
                  重置状态
                </button>
              )}
              <button
                onClick={this.handleReload}
                className="px-4 py-2 text-sm font-bold text-black bg-endfield-yellow hover:bg-yellow-400 rounded-none transition-colors flex items-center gap-2"
              >
                <RefreshCw size={16} />
                刷新页面
              </button>
              <button
                onClick={this.handleCopyDiagnostic}
                className="px-4 py-2 text-sm font-medium text-yellow-300 hover:text-yellow-200 hover:bg-yellow-500/10 border border-yellow-500/40 rounded-none transition-colors flex items-center gap-2"
              >
                <Clipboard size={16} />
                {this.state.copied ? '已复制' : '复制诊断信息'}
              </button>
            </div>

            {/* 提示 */}
            <p className="text-zinc-600 text-xs mt-6 text-left">
              如果刷新后仍然复现，请把诊断信息和当前操作路径一起发给管理员。
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
