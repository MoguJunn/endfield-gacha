import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MaintenanceNotice } from '../SiteMaintenanceBanner.jsx';
import { DEFAULT_MAINTENANCE_NOTICE } from '../../../../shared/siteMaintenance.js';

afterEach(cleanup);
describe('maintenance banner', () => {
  it('shows the current upgrade, service scope and a collapsible title that remains visible', () => {
    render(<MaintenanceNotice notice={DEFAULT_MAINTENANCE_NOTICE} />);
    expect(screen.getByRole('region', { name: '服务维护通知' })).toBeInTheDocument();
    expect(screen.getByText('即刻起，至升级完成')).toBeInTheDocument();
    fireEvent.click(screen.getByText('可能受影响的服务'));
    expect(screen.getByText('云端记录读取、同步、保存及数据工作台')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(screen.getByText('数据库服务器升级维护')).toBeInTheDocument();
    expect(screen.queryByText(DEFAULT_MAINTENANCE_NOTICE.message)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
    expect(screen.getByText(DEFAULT_MAINTENANCE_NOTICE.message)).toBeInTheDocument();
  });
  it('honors off, service-detail and collapse switches and supports English plain text', () => {
    const { rerender } = render(<MaintenanceNotice notice={{ ...DEFAULT_MAINTENANCE_NOTICE, enabled: false }} />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    rerender(<MaintenanceNotice english notice={{ ...DEFAULT_MAINTENANCE_NOTICE, showAffectedServices: false, allowCollapse: false, titleEn: '<img src=x>' }} />);
    expect(screen.getByText('<img src=x>')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('Services that may be affected')).not.toBeInTheDocument();
  });
});
