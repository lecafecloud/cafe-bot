#!/bin/sh
set -e

node build/deploy-commands.js
node build/index.js
