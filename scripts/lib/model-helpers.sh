#!/usr/bin/env bash

normalize_model() {
  local model="$1"
  case "$model" in
    gpt-5.2-*-low) echo "${model%-low}-l" ;;
    gpt-5.2-*-medium) echo "${model%-medium}-m" ;;
    gpt-5.2-*-high) echo "${model%-high}-h" ;;
    gpt-5.2-*-xhigh) echo "${model%-xhigh}-xh" ;;
    gpt-5.2-low) echo "gpt-5.2-l" ;;
    gpt-5.2-medium) echo "gpt-5.2-m" ;;
    gpt-5.2-high) echo "gpt-5.2-h" ;;
    gpt-5.2-xhigh) echo "gpt-5.2-xh" ;;
    *) echo "$model" ;;
  esac
}

infer_reasoning_effort() {
  local model="${1,,}"
  case "$model" in
    *-xhigh|*-xh) echo "xhigh" ;;
    *-high|*-h) echo "high" ;;
    *-medium|*-m) echo "medium" ;;
    *-low|*-l) echo "low" ;;
    *) echo "" ;;
  esac
}
