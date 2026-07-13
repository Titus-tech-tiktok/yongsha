-- 财神测款机 Web / Supabase 初始模型
-- 业务代码当前使用本地工作区适配器；切换 Supabase 时保持这些实体和 workspace_id 边界不变。

create extension if not exists pgcrypto;

create type public.workspace_role as enum ('owner', 'admin', 'operator', 'viewer');
create type public.asset_kind as enum ('product', 'print', 'template', 'free_source', 'output', 'export');
create type public.template_action as enum ('replace_print', 'copy_template', 'skip_copy', 'manual_check');
create type public.task_mode as enum ('template_print', 'master');
create type public.task_status as enum ('queued', 'generating', 'review', 'approved', 'failed');
create type public.review_status as enum ('pending', 'passed', 'rejected');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'operator',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.app_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  operator_code text not null default 'ys',
  audit_mode text not null default 'saving' check (audit_mode in ('saving', 'quality')),
  image_size text not null default '1024x1024',
  image_quality text not null default 'auto',
  active_product_collection text,
  active_print_collection text,
  active_template_collection text,
  updated_at timestamptz not null default now()
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind public.asset_kind not null,
  collection_key text not null default 'default',
  storage_bucket text not null,
  storage_path text not null,
  relative_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, kind, collection_key, relative_path)
);

create table public.template_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  template_asset_id uuid not null references public.assets(id) on delete cascade,
  action public.template_action not null default 'manual_check',
  confidence numeric(5,4) not null default 0 check (confidence between 0 and 1),
  reason text not null default '',
  replace_area text not null default '',
  forbidden_area text not null default '',
  regions jsonb not null default '[]'::jsonb,
  mask_storage_path text,
  analysis jsonb not null default '{}'::jsonb,
  manual_override boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (workspace_id, template_asset_id)
);

create table public.product_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  template_collection_key text not null,
  dimensions text not null default '',
  material text not null default '',
  notes text not null default '',
  extra jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (workspace_id, template_collection_key)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_number bigint not null,
  mode public.task_mode not null,
  product_asset_id uuid references public.assets(id) on delete restrict,
  print_asset_id uuid not null references public.assets(id) on delete restrict,
  template_collection_key text not null,
  note text not null default '',
  status public.task_status not null default 'queued',
  master_storage_path text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, task_number)
);

create table public.task_images (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  template_asset_id uuid references public.assets(id) on delete set null,
  relative_path text not null,
  output_storage_path text,
  action public.template_action not null,
  audit_status public.review_status not null default 'pending',
  manual_status public.review_status not null default 'pending',
  retry_instruction text not null default '',
  audit_payload jsonb not null default '{}'::jsonb,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (task_id, relative_path)
);

create table public.title_libraries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  category_name text not null,
  source_file_name text not null,
  prefix_roots text[] not null default '{}',
  required_roots text[] not null default '{}',
  root_candidates text[] not null default '{}',
  records jsonb not null default '[]'::jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, category_name)
);

create table public.title_generation_states (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  state_key text not null,
  next_variant_index integer not null default 1 check (next_variant_index > 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, state_key)
);

create table public.generated_titles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  category_name text not null default '',
  title text not null,
  variant_index integer not null default 1,
  created_at timestamptz not null default now()
);

create table public.operation_logs (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

create index assets_workspace_kind_idx on public.assets (workspace_id, kind, created_at desc);
create index assets_workspace_collection_idx on public.assets (workspace_id, collection_key, relative_path);
create index tasks_workspace_status_idx on public.tasks (workspace_id, status, updated_at desc);
create index task_images_task_status_idx on public.task_images (task_id, manual_status, audit_status);
create index title_libraries_workspace_idx on public.title_libraries (workspace_id, category_name);
create index operation_logs_task_idx on public.operation_logs (task_id, created_at desc);

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id and user_id = auth.uid()
  );
$$;

create or replace function public.create_workspace(workspace_name text, workspace_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_workspace_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  insert into public.workspaces (name, slug, created_by)
  values (trim(workspace_name), lower(trim(workspace_slug)), auth.uid())
  returning id into new_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, auth.uid(), 'owner');
  insert into public.app_settings (workspace_id) values (new_workspace_id);
  return new_workspace_id;
end;
$$;

grant execute on function public.create_workspace(text, text) to authenticated;

create or replace function public.storage_workspace_id(object_name text)
returns uuid
language plpgsql
immutable
as $$
begin
  return split_part(object_name, '/', 1)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.app_settings enable row level security;
alter table public.assets enable row level security;
alter table public.template_configs enable row level security;
alter table public.product_profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.task_images enable row level security;
alter table public.title_libraries enable row level security;
alter table public.title_generation_states enable row level security;
alter table public.generated_titles enable row level security;
alter table public.operation_logs enable row level security;

create policy workspaces_member_select on public.workspaces for select using (public.is_workspace_member(id));
create policy members_member_select on public.workspace_members for select using (public.is_workspace_member(workspace_id));

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'app_settings', 'assets', 'template_configs', 'product_profiles', 'tasks',
    'task_images', 'title_libraries', 'title_generation_states', 'generated_titles', 'operation_logs'
  ] loop
    execute format(
      'create policy %I on public.%I for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id))',
      table_name || '_workspace_access', table_name
    );
  end loop;
end $$;

-- Storage 对象路径统一为 <workspace_id>/<collection>/<relative_path>。
insert into storage.buckets (id, name, public)
values ('assets', 'assets', false), ('outputs', 'outputs', false), ('exports', 'exports', false)
on conflict (id) do nothing;

create policy storage_workspace_read on storage.objects for select
using (
  bucket_id in ('assets', 'outputs', 'exports')
  and public.is_workspace_member(public.storage_workspace_id(name))
);

create policy storage_workspace_write on storage.objects for all
using (
  bucket_id in ('assets', 'outputs', 'exports')
  and public.is_workspace_member(public.storage_workspace_id(name))
)
with check (
  bucket_id in ('assets', 'outputs', 'exports')
  and public.is_workspace_member(public.storage_workspace_id(name))
);
