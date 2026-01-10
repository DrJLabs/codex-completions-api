#!/usr/bin/env bash

normalize_model() {
  local model_in="$1"
  local model_lower
  model_lower="$(printf '%s' "$model_in" | tr '[:upper:]' '[:lower:]')"
  case "$model_lower" in
    gpt-5.2-*-low) printf '%s\n' "${model_in:0:${#model_in}-3}l" ;;
    gpt-5.2-*-medium) printf '%s\n' "${model_in:0:${#model_in}-6}m" ;;
    gpt-5.2-*-high) printf '%s\n' "${model_in:0:${#model_in}-4}h" ;;
    gpt-5.2-*-xhigh) printf '%s\n' "${model_in:0:${#model_in}-5}xh" ;;
    *) printf '%s\n' "$model_in" ;;
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
