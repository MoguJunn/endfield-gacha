import React from 'react';
import HomeWorkspace from '../../components/home/DesktopHomeDemo.jsx';
import './mobileHome.css';

/**
 * 与桌面共享日程和功能模块，使用移动端纵向布局。
 */
function MobileHomeView() {
  return (
    <div className="mobile-home-scroll flex-1 min-h-0 overflow-y-auto overscroll-y-contain">
      <HomeWorkspace mobile />
    </div>
  );
}

export default MobileHomeView;
