import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PoolEditDialog from '../pools/PoolEditDialog.jsx';
import { INITIAL_POOL_FORM } from '../../../hooks/admin/usePools.js';

vi.mock('../../common/DateTimePicker', () => ({ default: ({ label, value }) => <output aria-label={label}>{value}</output> }));
const pools = [
  { pool_id: 'one', name: '第一期', type: 'limited', start_time: '2026-10-15T04:00:00Z', end_time: '2026-11-05T04:00:00Z' },
  { pool_id: 'two', name: '第二期', type: 'limited', start_time: '2026-11-05T04:00:00Z', end_time: '2026-11-26T04:00:00Z' },
  { pool_id: 'three', name: '第三期', type: 'limited', start_time: '2026-11-26T04:00:00Z', end_time: '2026-12-17T04:00:00Z' },
];

function Harness({ save }) {
  const [form, setForm] = useState({ ...INITIAL_POOL_FORM, type: 'weapon', start_time: pools[0].start_time });
  return <PoolEditDialog show poolForm={form} setPoolForm={setForm} characters={[]} pools={pools}
    editingPoolCharacters={[]} checkUpCharacterExists={() => true} onClose={() => {}}
    onSave={() => save(form)} onToggleCharacter={() => {}} onAddAllCharacters={() => {}} onRemoveAllCharacters={() => {}} />;
}

describe('武器池编辑三期截止时间', () => {
  it('显示自动匹配，按按钮填入，允许切换为手动关联并保存', () => {
    const save = vi.fn();
    render(<Harness save={save} />);
    expect(screen.getByRole('option', { name: '自动识别：第一期' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '一键填入第三期截止时间' }));
    expect(screen.getByLabelText('同期开启的限定角色池').value).toBe('one');
    expect(new Date(screen.getByLabelText('结束时间').textContent).toISOString()).toBe(pools[2].end_time.replace('Z', '.000Z'));
    fireEvent.change(screen.getByLabelText('同期开启的限定角色池'), { target: { value: 'two' } });
    fireEvent.click(screen.getByRole('button', { name: '一键填入第三期截止时间（估算）' }));
    fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }));
    expect(save.mock.calls[0][0].character_pool_id).toBe('two');
  });
});
