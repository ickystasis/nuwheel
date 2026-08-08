import os
import shutil
import subprocess
import tempfile

FFMPEG = 'ffmpeg'
AUDIO_EXTS = ('.mp3', '.wav')

# Files that have been successfully loudness-normalized are renamed with this
# prefix so it's obvious at a glance which audio has been processed.
NORM_PREFIX = 'N_'

# EBU R128 integrated loudness targets, in LUFS.
# Music plays during the spin underneath the (presumably louder) room, so it is
# leveled a touch quieter than cheers, which are short and punchy.
MUSIC_LUFS = -16.0
CHEER_LUFS = -14.0

# Directory name -> loudness target. Used by the batch normalizer to decide
# how loud each discovered file should be without any extra configuration.
TARGET_DIRS = {
    'music': MUSIC_LUFS,
    'song': MUSIC_LUFS,
    'cheers': CHEER_LUFS,
    'cheer': CHEER_LUFS,
}


def ffmpeg_available():
    return shutil.which(FFMPEG) is not None


def target_for_dirname(dirname):
    if not dirname:
        return None
    return TARGET_DIRS.get(dirname.lower())


def _is_audio_file(path):
    ext = os.path.splitext(path)[1].lower()
    return ext in AUDIO_EXTS


def normalized_filename(filename):
    """Return the name a file should use after normalization (N_ prefix, applied once)."""
    base = os.path.basename(filename)
    if base.startswith(NORM_PREFIX):
        return base
    return NORM_PREFIX + base


def normalize_audio(path, target_lufs=MUSIC_LUFS):
    """Normalize a single audio file to the given loudness.

    On success the file is renamed with the N_ prefix so normalized audio is
    easy to tell apart (a file that's already prefixed keeps its name).

    Returns (ok: bool, message: str).
    """
    if not path or not os.path.exists(path):
        return False, 'file not found'
    if not _is_audio_file(path):
        return False, 'not an audio file'
    if not ffmpeg_available():
        return False, 'ffmpeg not available'

    ext = os.path.splitext(path)[1].lower()
    base_dir = os.path.dirname(path) or '.'
    fd, tmp = tempfile.mkstemp(prefix='.nuwheel-norm-', suffix=ext, dir=base_dir)
    os.close(fd)

    # Trim leading/trailing silence so quiet intros don't tank the integrated
    # loudness reading, then match the perceived level with EBU R128 (loudnorm).
    cmd = [
        FFMPEG, '-nostdin', '-y', '-loglevel', 'error',
        '-i', path,
        '-af',
        'silenceremove=start_periods=1:start_duration=0.15:start_threshold=-45dB,'
        f'loudnorm=I={target_lufs:.2f}:LRA=11:TP=-1.5',
        '-ar', '44100', '-ac', '2',
    ]
    if ext == '.mp3':
        cmd += ['-c:a', 'libmp3lame', '-q:a', '2']
    else:
        cmd += ['-c:a', 'pcm_s16le']
    cmd.append(tmp)

    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=180,
        )
    except (subprocess.TimeoutExpired, OSError) as e:
        _cleanup(tmp)
        return False, str(e)

    if proc.returncode != 0:
        _cleanup(tmp)
        tail = (proc.stderr or b'').decode('utf-8', 'replace').strip()[-300:]
        return False, tail or 'ffmpeg failed'

    if not os.path.exists(tmp) or os.path.getsize(tmp) == 0:
        _cleanup(tmp)
        return False, 'ffmpeg produced no output'

    os.replace(tmp, path)
    new_path = os.path.join(base_dir, normalized_filename(path))
    if new_path != path:
        os.replace(path, new_path)
    return True, f'normalized to {target_lufs:.0f} LUFS'


def _cleanup(tmp):
    try:
        os.remove(tmp)
    except OSError:
        pass