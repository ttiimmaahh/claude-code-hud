// Shape of the JSON Claude Code writes to our stdin on each statusline tick.
// Documented at: https://docs.claude.com/en/docs/claude-code/statusline
export interface StatusLineInput {
  hook_event_name: "Status";
  session_id: string;
  transcript_path: string;    // absolute path to the JSONL transcript
  cwd: string;
  model: { id: string; display_name: string };
  workspace: { current_dir: string; project_dir: string };
  version?: string;
  output_style?: { name: string };
  cost?: {
    total_cost_usd: number;
    total_duration_ms: number;
    total_api_duration_ms: number;
    total_lines_added: number;
    total_lines_removed: number;
  };
  exceeds_200k_tokens?: boolean;
}

// One line of the transcript JSONL. Claude Code writes heterogeneous records;
// we only type the fields we actually read.
export interface TranscriptEntry {
  type: "user" | "assistant" | "system" | "summary";
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      output_tokens?: number;
    };
    content?: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; name: string; input: unknown; id: string }
      | { type: "tool_result"; tool_use_id: string; content: unknown }
    >;
  };
  toolUseResult?: unknown;
}
