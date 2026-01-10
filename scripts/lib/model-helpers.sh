#!/usr/bin/env bash

normalize_model() {
  local model="$1"
  case "$model" in
    gpt-5.2-*-low) echo "${model%-low}-l" ;;
    gpt-5.2-*-medium) echo "${model%-medium}-m" ;;
    gpt-5.2-*-high) echo "${model%-high}-h" ;;
    gpt-5.2-*-xhigh) echo "${model%-xhigh}-xh" ;;
    *) echo "$model" ;;
  esac
}

infer_reasoning_effort() {
  local model
  model="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$model" in
    *-xhigh|*-xh) echo "xhigh" ;;
    *-high|*-h) echo "high" ;;
    *-medium|*-m) echo "medium" ;;
    *-low|*-l) echo "low" ;;
    *) echo "" ;;
  esac
}
