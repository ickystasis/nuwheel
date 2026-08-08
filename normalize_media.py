#!/usr/bin/env python3
"""Loudness-normalize existing audio files (EBU R128 via ffmpeg).

Target loudness is derived from the directory name the file lives under:
    music / song  -> -16 LUFS   (spin music)
    cheers / cheer -> -14 LUFS  (victory cheers)

Usage:
    python normalize_media.py [ROOT ...] [--dry-run]

If no roots are given, this normalizes the default pools
(data/media/default) plus the user-media tree at <DB_DIR>/media when it
exists (DB_DIR defaults to /data).

Files in directories that don't map to a target are left alone.
"""

import argparse
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def _load_helper():
    path = os.path.join(HERE, 'app', 'audio_loudness.py')
    spec = importlib.util.spec_from_file_location('_nuwheel_audio_loudness', path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def detect_target(mod, root, rel_dir):
    parts = [p for p in rel_dir.split(os.sep) if p]
    for part in reversed(parts):
        target = mod.target_for_dirname(part)
        if target is not None:
            return target
    return mod.target_for_dirname(os.path.basename(os.path.normpath(root)))


def main():
    parser = argparse.ArgumentParser(description='Loudness-normalize audio files with ffmpeg (EBU R128).')
    parser.add_argument('roots', nargs='*', help='directories/trees to scan (default: built-in pools + user media)')
    parser.add_argument('--dry-run', action='store_true', help='report what would change without writing files')
    args = parser.parse_args()

    mod = _load_helper()
    if not mod.ffmpeg_available():
        print('ERROR: ffmpeg not found on PATH', file=sys.stderr)
        return 1

    roots = list(args.roots)
    if not roots:
        roots = [
            os.path.join(HERE, 'data', 'media', 'default'),
        ]
        data_media = os.path.join(os.environ.get('DB_DIR', '/data'), 'media')
        if os.path.isdir(data_media):
            roots.append(data_media)

    stats = {'scanned': 0, 'normalized': 0, 'skipped': 0, 'failed': 0, 'changed': 0}
    for root in roots:
        if not os.path.isdir(root):
            print(f'skipping missing root: {root}')
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            rel_dir = os.path.relpath(dirpath, root)
            target = detect_target(mod, root, rel_dir)
            for name in sorted(filenames):
                path = os.path.join(dirpath, name)
                if os.path.splitext(name)[1].lower() not in mod.AUDIO_EXTS:
                    continue
                stats['scanned'] += 1
                if target is None:
                    stats['skipped'] += 1
                    if args.dry_run:
                        print(f'skip     {path} (no loudness target)')
                    continue
                if args.dry_run:
                    print(f'would    {path} -> {target:.0f} LUFS')
                    stats['changed'] += 1
                    continue
                ok, msg = mod.normalize_audio(path, target_lufs=target)
                if ok:
                    stats['normalized'] += 1
                    print(f'ok       {path} ({msg})')
                else:
                    stats['failed'] += 1
                    print(f'FAIL     {path}: {msg}', file=sys.stderr)

    print('\n'.join([
        '',
        f'scanned:   {stats["scanned"]}',
        f'normalized:{stats["normalized"]}',
        f'skipped:   {stats["skipped"]}',
        f'failed:    {stats["failed"]}',
    ]))
    return 1 if stats['failed'] else 0


if __name__ == '__main__':
    sys.exit(main())
