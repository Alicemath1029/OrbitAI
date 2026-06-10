import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional, Sequence


class ExportError(RuntimeError):
    pass


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Export an Orbit checkpoint into a model artifact.")
    parser.add_argument("--framework", required=True)
    parser.add_argument("--format", required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)

    try:
        export_checkpoint(
            framework=args.framework,
            export_format=args.format,
            checkpoint=Path(args.checkpoint),
            output=Path(args.output),
        )
        return 0
    except ExportError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1


def export_checkpoint(framework: str, export_format: str, checkpoint: Path, output: Path) -> Dict[str, Any]:
    framework = framework.strip().lower()
    export_format = export_format.strip().lower()
    if not checkpoint.exists():
        raise ExportError(f"checkpoint path does not exist: {checkpoint}")
    output.mkdir(parents=True, exist_ok=True)

    if framework == "deepspeed":
        manifest = _export_deepspeed(checkpoint, output, export_format)
    else:
        manifest = _export_basic_copy(checkpoint, output, framework, export_format)

    size_bytes = _size_bytes(output)
    manifest.update(
        {
            "schemaVersion": "orbit.model_export.manifest.v1",
            "framework": framework,
            "format": export_format,
            "checkpoint": str(checkpoint),
            "output": str(output),
            "sizeBytes": size_bytes,
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    )
    manifest_path = output / "export_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    print(f"[RESULT] size_bytes={size_bytes} output_path={output}")
    return manifest


def _export_deepspeed(checkpoint: Path, output: Path, export_format: str) -> Dict[str, Any]:
    if export_format not in {"pytorch", "huggingface"}:
        raise ExportError(f"unsupported deepspeed export format: {export_format}")
    converter = shutil.which("zero_to_fp32.py")
    if converter is None:
        raise ExportError("zero_to_fp32.py is required for deepspeed export but was not found in PATH")

    output_file = output / "pytorch_model.bin"
    try:
        subprocess.run([converter, str(checkpoint), str(output_file)], check=True)
    except subprocess.CalledProcessError as exc:
        raise ExportError(f"zero_to_fp32.py failed with exit code {exc.returncode}") from exc
    manifest: Dict[str, Any] = {
        "exportMode": "deepspeed-zero-to-fp32",
        "outputFiles": [output_file.name],
    }
    if export_format == "huggingface":
        manifest["notes"] = "Only pytorch_model.bin is generated; HuggingFace config/tokenizer files are not synthesized."
    return manifest


def _export_basic_copy(checkpoint: Path, output: Path, framework: str, export_format: str) -> Dict[str, Any]:
    copied = []
    if checkpoint.is_dir():
        for item in checkpoint.iterdir():
            destination = output / item.name
            if item.resolve() == output.resolve():
                continue
            if item.is_dir():
                shutil.copytree(item, destination, dirs_exist_ok=True)
            else:
                shutil.copy2(item, destination)
            copied.append(item.name)
    else:
        destination = output / checkpoint.name
        shutil.copy2(checkpoint, destination)
        copied.append(checkpoint.name)

    return {
        "exportMode": "basic-copy",
        "sourceFramework": framework,
        "requestedFormat": export_format,
        "copied": copied,
    }


def _size_bytes(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    total = 0
    for item in path.rglob("*"):
        if item.is_file():
            total += item.stat().st_size
    return total


if __name__ == "__main__":
    raise SystemExit(main())
