#!/bin/bash
echo "Using npm instead of yarn"
npm install --omit=dev || true
