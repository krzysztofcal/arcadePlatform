#!/usr/bin/python3
"""Narrow Netlify adapter: read-only plan, unchanged-value permission probe, explicit apply.
No build/deploy API, global env mutation, Auth or Redis data writes.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('xp_operator', ROOT / 'infra/vps/xp-v3-operator.py')
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)
KEYS = (*operator.REDIS_KEYS, 'XP_REDIS_VERSION', 'XP_REDIS_ENV', 'XP_KEY_NS', 'ACCOUNT_DELETION_ENABLED')
BRANCH = 'feat/1117-account-deletion-v2'
PRIVATE = Path.home() / 'arcade-xp-v3-cutover'


def read_private(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd) as stream:
        meta = os.fstat(stream.fileno())
        operator.require(stat.S_ISREG(meta.st_mode) and meta.st_uid == os.getuid()
                         and meta.st_nlink == 1 and stat.S_IMODE(meta.st_mode) == 0o600, 'unsafe_private_file')
        return json.load(stream)


def main(mode):
    configuration = read_private(Path.home() / '.config/netlify/config.json')
    token = configuration['users'][configuration['userId']]['auth']['token']
    site_id = json.loads((Path('/home/copilot/work/arcadePlatform/.netlify/state.json')).read_text())['siteId']
    client = urllib.request.build_opener(operator.NoRedirect)

    def api(path, method='GET', body=None):
        request = urllib.request.Request('https://api.netlify.com/api/v1/' + path,
            data=None if body is None else json.dumps(body).encode(), method=method,
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        with client.open(request, timeout=25) as response:
            return json.load(response)

    site = api('sites/' + site_id)
    operator.require(site['name'] == 'playkcswh', 'wrong_site')
    root = 'accounts/' + site['account_id'] + '/env'
    before = api(root + '?site_id=' + site_id)
    selected = {row['key']: row for row in before if row['key'] in KEYS}
    operator.require(set(selected) == set(KEYS), 'missing_existing_variable')

    def value(key, stage):
        row = next(row for row in before if row['key'] == key)
        contexts = [('branch', BRANCH), ('deploy-preview', None), ('all', None)] if stage else [('production', None), ('all', None)]
        operator.require(not any(v['context'] == 'branch' and v.get('context_parameter') == 'main' for v in row['values']), 'unexpected_main_branch_override')
        for context, parameter in contexts:
            found = [v for v in row['values'] if v['context'] == context and (parameter is None or v.get('context_parameter') == parameter)]
            operator.require(len(found) <= 1, 'ambiguous_context')
            if found:
                return found[0]['value']
        return None

    for stage, ref in [(True, operator.REFS['stage']), (False, operator.REFS['prod'])]:
        operator.require(value('SUPABASE_URL', stage).rstrip('/') == 'https://' + ref + '.supabase.co', 'supabase_context_mismatch')
        db = operator.urllib.parse.urlsplit(value('SUPABASE_DB_URL', stage))
        operator.require(operator.urllib.parse.unquote(db.username or '') == 'postgres.' + ref
            or (db.hostname == 'db.' + ref + '.supabase.co' and db.username == 'postgres'), 'db_context_mismatch')
    urls = [value(operator.REDIS_KEYS[0], stage).rstrip('/') for stage in (True, False)]
    operator.require(urls[0] == urls[1] and operator.digest(urls[0].encode()) == operator.ENDPOINT_HASH, 'redis_endpoint_mismatch')
    allowed = set()
    if mode == 'probe':
        # Same effective value; add/replace ONLY the production namespace override.
        # This tests actual Production-scope permission without enabling V3.
        current = value('XP_KEY_NS', False)
        operator.require(current in ('kcswh:xp:v2', 'kcswh:prod:xp:v3'), 'unexpected_production_namespace')
        updates = [('XP_KEY_NS', {'context': 'production', 'value': current})]
    elif mode == 'apply':
        old = read_private(Path('/var/lib/arcade-xp-v3/redis-old.json'))
        new = read_private(Path('/var/lib/arcade-xp-v3/redis-new.json'))
        operator.verify_new(old, new)
        updates = []
        for stage in (False, True):
            context = {'context': 'branch', 'context_parameter': BRANCH} if stage else {'context': 'production'}
            target = 'stage' if stage else 'prod'
            desired = {**new, 'XP_REDIS_VERSION': '3', 'XP_REDIS_ENV': target,
                       'XP_KEY_NS': f'kcswh:{target}:xp:v3', 'ACCOUNT_DELETION_ENABLED': '0'}
            for key, wanted in desired.items():
                updates.append((key, {**context, 'value': wanted}))
        # Backup only Redis/settings, never the full env response or Supabase credentials.
        operator.SecureFiles(uid=os.getuid(), gid=os.getgid(), boundary=Path('/')).parents(PRIVATE / 'netlify-redis.before.json')
        operator.require(stat.S_IMODE(PRIVATE.stat().st_mode) == 0o700, 'unsafe_private_directory')
        snapshot = PRIVATE / 'netlify-redis.before.json'
        if not snapshot.exists():
            fd = os.open(snapshot, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'w') as stream:
                json.dump(selected, stream); stream.flush(); os.fsync(stream.fileno())
    else:
        updates = []
    for key, update in updates:
        operator.require(set(selected[key]['scopes']) >= {'builds', 'functions'}, 'missing_function_scope')
        allowed.add((key, update['context'], update.get('context_parameter')))
        api(root + '/' + key + '?site_id=' + site_id, 'PATCH', update)
    after = api(root + '?site_id=' + site_id) if updates else before
    after_map = {row['key']: row for row in after}
    operator.require(set(after_map) == {row['key'] for row in before}, 'unexpected_variable_change')
    for row in before:
        result = after_map[row['key']]
        previous_ids = {(v['context'], v.get('context_parameter')) for v in row['values']}
        operator.require(all((v['context'], v.get('context_parameter')) in previous_ids
            or (row['key'], v['context'], v.get('context_parameter')) in allowed
            for v in result['values']), 'unexpected_context_change')
        operator.require(result['scopes'] == row['scopes'], 'unexpected_scope_change')
        for previous in row['values']:
            identity = (row['key'], previous['context'], previous.get('context_parameter'))
            if identity not in allowed:
                present = [v for v in result['values'] if (v['context'], v.get('context_parameter')) == identity[1:]]
                operator.require(len(present) == 1 and present[0]['value'] == previous['value'], 'unrelated_value_changed')
    for key, update in updates:
        found = [v for v in after_map[key]['values'] if v['context'] == update['context'] and v.get('context_parameter') == update.get('context_parameter')]
        operator.require(len(found) == 1 and found[0]['value'] == update['value'], 'write_not_confirmed')
    return {'phase': mode, 'site': 'playkcswh', 'stageAndProductionTargetsVerified': True,
            'writes': len(updates), 'unrelatedValuesAndScopesPreserved': True, 'deployTriggered': False}


if __name__ == '__main__':
    os.umask(0o077)
    try:
        operator.require(len(sys.argv) == 2 and sys.argv[1] in ('plan', 'probe', 'apply'), 'invalid_arguments')
        print(json.dumps(main(sys.argv[1])))
    except Exception as error:
        code = str(error) if isinstance(error, operator.Refused) else 'netlify_operation_failed'
        sys.stderr.write(json.dumps({'status': 'NO-GO', 'code': code}) + '\n')
        sys.exit(1)
