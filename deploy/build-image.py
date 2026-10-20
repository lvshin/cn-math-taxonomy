#!/usr/bin/env python3
"""Build an already-tested server JAR and a small Java25 readiness probe into an image."""
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent
if not (root / 'server/target/family-learning-server.jar').is_file():
    raise SystemExit('Build and verify the server JAR first.')
build = root / 'deploy/.build'
build.mkdir(exist_ok=True)
subprocess.run(['javac', '--release', '25', '-d', str(build), str(root / 'deploy/HealthCheck.java')], check=True)
command = ['docker', 'build', '--platform', os.environ.get('TARGET_PLATFORM', 'linux/amd64'),
           '-f', 'deploy/Dockerfile', '-t', os.environ['APP_IMAGE']]
runtime = os.environ.get('JAVA_RUNTIME')
if runtime:
    command += ['--build-arg', 'JAVA_RUNTIME=' + runtime]
subprocess.run(command + ['.'], cwd=root, check=True)
