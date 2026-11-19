-- ============================================================
-- GroupMate v2 升级脚本（数据库里已经有数据时用这个）
-- 位置：Supabase Dashboard → SQL Editor → 新建查询 → 粘贴 → Run
-- 作用：只新增字段 / 触发器 / 函数，不删除任何已有数据。
-- ============================================================
begin;

-- 需求2：一项任务可以有多个负责人
alter table public.tasks add column if not exists assignee_ids uuid[] not null default '{}';
-- 需求5：记录任务开始 / 完成时间
alter table public.tasks add column if not exists started_at timestamptz;
alter table public.tasks add column if not exists completed_at timestamptz;

-- 把旧的单个负责人迁移到数组
update public.tasks
   set assignee_ids = array[assignee_id]
 where assignee_id is not null
   and coalesce(array_length(assignee_ids,1),0) = 0;

create index if not exists tasks_project_idx on public.tasks(project_id);
create index if not exists tasks_due_idx on public.tasks(project_id, due_date);

-- 需求5：状态变化时自动打时间戳
create or replace function public.tasks_stamp_status()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'doing' then
      new.started_at := coalesce(new.started_at, now());
    elsif new.status = 'done' then
      new.started_at := coalesce(new.started_at, now());
      new.completed_at := coalesce(new.completed_at, now());
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'doing' then
      new.started_at := coalesce(new.started_at, now());
      new.completed_at := null;
    elsif new.status = 'done' then
      new.started_at := coalesce(new.started_at, now());
      new.completed_at := now();
    else
      new.started_at := null;
      new.completed_at := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tasks_stamp_status on public.tasks;
create trigger tasks_stamp_status
  before insert or update on public.tasks
  for each row execute procedure public.tasks_stamp_status();

-- 需求6：组长把组长身份转给其他成员
create or replace function public.set_project_leader(p_project_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  if not exists(select 1 from public.project_members where project_id=p_project_id and user_id=auth.uid() and role='owner') then
    raise exception '只有组长可以调整组长';
  end if;
  if not exists(select 1 from public.project_members where project_id=p_project_id and user_id=p_user_id) then
    raise exception '该成员不在项目中';
  end if;
  update public.project_members set role='member' where project_id=p_project_id;
  update public.project_members set role='owner' where project_id=p_project_id and user_id=p_user_id;
end; $$;

grant execute on function public.set_project_leader(uuid,uuid) to authenticated;

commit;
