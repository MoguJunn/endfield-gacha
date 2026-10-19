import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SiteMaintenanceSettings from '../SiteMaintenanceSettings.jsx';
import { MAINTENANCE_CONFIG_KEY } from '../../../../../shared/siteMaintenance.js';

afterEach(cleanup);
describe('administrator maintenance settings', () => {
  it('saves all switches and selected affected services together through the existing admin adapter', async () => {
    const adapter = { updateConfig: vi.fn().mockResolvedValue(true) };
    const onSaved = vi.fn();
    render(<SiteMaintenanceSettings value={JSON.stringify({ enabled: false })} configAdapter={adapter} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '开启维护模式' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '允许用户收起横幅' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '模拟器及其他功能的云端存档' }));
    fireEvent.change(screen.getByLabelText('维护标题'), { target: { value: '本次数据库升级' } });
    fireEvent.click(screen.getByRole('button', { name: '保存维护配置' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const [key, value, meta] = adapter.updateConfig.mock.calls[0];
    expect(key).toBe(MAINTENANCE_CONFIG_KEY);
    expect(JSON.parse(value)).toMatchObject({ enabled: true, allowCollapse: false, title: '本次数据库升级' });
    expect(JSON.parse(value).affectedServices).not.toContain('saves');
    expect(meta.category).toBe('alert');
  });
  it('keeps the draft and reports failed saves without claiming maintenance is enabled', async () => {
    const adapter = { updateConfig: vi.fn().mockResolvedValue(false), getError: () => new Error('数据库连接失败') };
    const onSaved = vi.fn();
    render(<SiteMaintenanceSettings value={JSON.stringify({ enabled: false })} configAdapter={adapter} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '开启维护模式' }));
    fireEvent.click(screen.getByRole('button', { name: '保存维护配置' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('数据库连接失败');
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: '开启维护模式' })).toBeChecked();
  });
});
