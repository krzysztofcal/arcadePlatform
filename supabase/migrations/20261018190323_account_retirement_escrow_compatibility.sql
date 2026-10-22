-- #1117 forward-only: recognize only the exact reviewed USER guard in the
-- existing Stage escrow-retirement dependency inventory. Unknown triggers still deny.
begin;
do $pruner_access$
declare membership jsonb;
begin
 select to_jsonb(m) into membership from pg_auth_members m
 where m.roleid='chips_ledger_archive_pruner'::regrole and m.member=current_user::regrole
   and m.grantor=current_user::regrole;
 perform set_config('arcade1117.pruner_membership',coalesce(membership::text,'null'),true);
 perform set_config('arcade1117.pruner_create',has_schema_privilege('chips_ledger_archive_pruner','public','CREATE')::text,true);
 execute format('grant chips_ledger_archive_pruner to %I with set true',current_user);
end $pruner_access$;
grant create on schema public to chips_ledger_archive_pruner;
set local role chips_ledger_archive_pruner;
do $escrow_compatibility$
declare definition text;
 needle text := $needle$and triggers.tgname <> 'chips_accounts_escrow_retirement_guard'$needle$;
 replacement text := $replacement$and triggers.tgname <> 'chips_accounts_escrow_retirement_guard'
       and not (triggers.tgname = 'chips_accounts_user_retirement_v2'
         and triggers.tgfoid = 'public.chips_guard_user_retirement_v2()'::regprocedure
         and triggers.tgtype = 31 and triggers.tgenabled = 'O'
         and triggers.tgnargs = 0)$replacement$;
begin
 select pg_get_functiondef('public.chips_retire_stage_escrow_accounts(bigint,uuid[],text,text,text,boolean,text)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle) <> 2
   or strpos(definition,'Unknown DELETE trigger dependency blocks account retirement')=0 then
   raise exception 'Unexpected escrow retirement dependency inventory';
 end if;
 execute replace(definition,needle,replacement);
end $escrow_compatibility$;

reset role;
do $restore_pruner_access$
declare membership jsonb := current_setting('arcade1117.pruner_membership')::jsonb;
begin
 if not current_setting('arcade1117.pruner_create')::boolean then
   revoke create on schema public from chips_ledger_archive_pruner;
 end if;
 if membership='null'::jsonb then
   execute format('revoke chips_ledger_archive_pruner from %I',current_user);
 else
   execute format('grant chips_ledger_archive_pruner to %I with set %s',current_user,membership->>'set_option');
 end if;
end $restore_pruner_access$;
commit;
