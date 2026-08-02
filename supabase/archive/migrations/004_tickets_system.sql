-- 工单系统数据库表结构
-- 支持用户向管理员、管理员向超管提交工单

-- ============================================
-- 0. 清理旧数据（如果存在）
-- ============================================

-- 删除旧的表（注意顺序：先删除有外键依赖的表）
-- 表级策略、索引和触发器会随表一并删除；先删表也能兼容真正的空数据库。
DROP TABLE IF EXISTS ticket_replies;
DROP TABLE IF EXISTS tickets;

-- 删除旧的函数
DROP FUNCTION IF EXISTS update_tickets_updated_at();
DROP FUNCTION IF EXISTS get_ticket_stats();

-- ============================================
-- 1. 创建工单主表
-- ============================================
CREATE TABLE IF NOT EXISTS tickets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_role TEXT NOT NULL CHECK (target_role IN ('admin', 'super_admin')),
  type TEXT NOT NULL DEFAULT 'question' CHECK (type IN ('bug', 'feature', 'question', 'data_issue', 'other')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'resolved', 'rejected', 'closed')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  resolution_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. 创建工单回复表
-- ============================================
CREATE TABLE IF NOT EXISTS ticket_replies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT FALSE,  -- 内部备注，仅管理员可见
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 3. 创建索引
-- ============================================
CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_target_role ON tickets(target_role);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_replies_ticket_id ON ticket_replies(ticket_id);

-- ============================================
-- 4. 启用 RLS
-- ============================================
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_replies ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 5. 工单表 RLS 策略
-- ============================================

-- 5.1 查看策略：用户可以查看自己创建的工单
CREATE POLICY "Users can view own tickets"
  ON tickets FOR SELECT
  USING (auth.uid() = user_id);

-- 5.2 查看策略：管理员可以查看发给管理员的工单
CREATE POLICY "Admins can view admin tickets"
  ON tickets FOR SELECT
  USING (
    target_role = 'admin' AND
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

-- 5.3 查看策略：超级管理员可以查看所有工单
CREATE POLICY "Super admins can view all tickets"
  ON tickets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- 5.4 创建策略：认证用户可以创建工单
CREATE POLICY "Users can create tickets"
  ON tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 5.5 更新策略：用户可以更新自己的待处理工单
CREATE POLICY "Users can update own pending tickets"
  ON tickets FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

-- 5.6 更新策略：管理员可以更新发给管理员的工单
CREATE POLICY "Admins can update admin tickets"
  ON tickets FOR UPDATE
  USING (
    target_role = 'admin' AND
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

-- 5.7 更新策略：超级管理员可以更新所有工单
CREATE POLICY "Super admins can update all tickets"
  ON tickets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- 5.8 删除策略：用户可以删除自己的待处理工单
CREATE POLICY "Users can delete own pending tickets"
  ON tickets FOR DELETE
  USING (auth.uid() = user_id AND status = 'pending');

-- 5.9 删除策略：超级管理员可以删除任何工单
CREATE POLICY "Super admins can delete any ticket"
  ON tickets FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- ============================================
-- 6. 工单回复表 RLS 策略
-- ============================================

-- 6.1 查看策略：可以查看自己工单的回复
CREATE POLICY "Users can view replies on own tickets"
  ON ticket_replies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tickets
      WHERE tickets.id = ticket_replies.ticket_id
      AND tickets.user_id = auth.uid()
    )
    AND (NOT is_internal)  -- 用户看不到内部备注
  );

-- 6.2 查看策略：管理员可以查看管理员工单的回复
CREATE POLICY "Admins can view replies on admin tickets"
  ON ticket_replies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tickets
      WHERE tickets.id = ticket_replies.ticket_id
      AND tickets.target_role = 'admin'
    )
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

-- 6.3 查看策略：超级管理员可以查看所有回复
CREATE POLICY "Super admins can view all replies"
  ON ticket_replies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- 6.4 创建策略：工单相关人员可以创建回复
CREATE POLICY "Related users can create replies"
  ON ticket_replies FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    (
      -- 工单创建者可以回复
      EXISTS (
        SELECT 1 FROM tickets
        WHERE tickets.id = ticket_replies.ticket_id
        AND tickets.user_id = auth.uid()
      )
      OR
      -- 管理员可以回复管理员工单
      (
        EXISTS (
          SELECT 1 FROM tickets
          WHERE tickets.id = ticket_replies.ticket_id
          AND tickets.target_role = 'admin'
        )
        AND EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.role IN ('admin', 'super_admin')
        )
      )
      OR
      -- 超级管理员可以回复任何工单
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
      )
    )
  );

-- ============================================
-- 7. 自动更新 updated_at 触发器
-- ============================================
CREATE OR REPLACE FUNCTION update_tickets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tickets_updated_at_trigger
  BEFORE UPDATE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_tickets_updated_at();

-- ============================================
-- 8. 工单统计 RPC 函数（仅管理员可用）
-- ============================================
CREATE OR REPLACE FUNCTION get_ticket_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  user_role TEXT;
BEGIN
  -- 获取当前用户角色
  SELECT role INTO user_role FROM profiles WHERE id = auth.uid();

  -- 仅管理员可调用
  IF user_role NOT IN ('admin', 'super_admin') THEN
    RETURN json_build_object('error', 'Unauthorized');
  END IF;

  SELECT json_build_object(
    'total', COALESCE((SELECT COUNT(*) FROM tickets), 0),
    'pending', COALESCE((SELECT COUNT(*) FROM tickets WHERE status = 'pending'), 0),
    'processing', COALESCE((SELECT COUNT(*) FROM tickets WHERE status = 'processing'), 0),
    'resolved', COALESCE((SELECT COUNT(*) FROM tickets WHERE status = 'resolved'), 0),
    'byType', json_build_object(
      'bug', COALESCE((SELECT COUNT(*) FROM tickets WHERE type = 'bug'), 0),
      'feature', COALESCE((SELECT COUNT(*) FROM tickets WHERE type = 'feature'), 0),
      'question', COALESCE((SELECT COUNT(*) FROM tickets WHERE type = 'question'), 0),
      'data_issue', COALESCE((SELECT COUNT(*) FROM tickets WHERE type = 'data_issue'), 0),
      'other', COALESCE((SELECT COUNT(*) FROM tickets WHERE type = 'other'), 0)
    ),
    'byPriority', json_build_object(
      'urgent', COALESCE((SELECT COUNT(*) FROM tickets WHERE priority = 'urgent' AND status IN ('pending', 'processing')), 0),
      'high', COALESCE((SELECT COUNT(*) FROM tickets WHERE priority = 'high' AND status IN ('pending', 'processing')), 0),
      'medium', COALESCE((SELECT COUNT(*) FROM tickets WHERE priority = 'medium' AND status IN ('pending', 'processing')), 0),
      'low', COALESCE((SELECT COUNT(*) FROM tickets WHERE priority = 'low' AND status IN ('pending', 'processing')), 0)
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- 授权
GRANT EXECUTE ON FUNCTION get_ticket_stats() TO authenticated;

-- ============================================
-- 9. 添加注释
-- ============================================
COMMENT ON TABLE tickets IS '工单表：用户向管理员或超管提交的问题/建议';
COMMENT ON TABLE ticket_replies IS '工单回复表：工单的对话记录';
COMMENT ON COLUMN tickets.target_role IS '目标角色：admin-发给管理员，super_admin-发给超管';
COMMENT ON COLUMN tickets.type IS '工单类型：bug/feature/question/data_issue/other';
COMMENT ON COLUMN tickets.status IS '状态：pending/processing/resolved/rejected/closed';
COMMENT ON COLUMN tickets.priority IS '优先级：low/medium/high/urgent';
COMMENT ON COLUMN ticket_replies.is_internal IS '是否为内部备注（仅管理员可见）';
