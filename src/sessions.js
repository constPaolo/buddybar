'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const MAX_STEPS = 200;

/** Short, human readable description of a tool call. */
function summarizeTool(name, input = {}) {
  const base = (p) => (p ? path.basename(String(p)) : '');
  switch (name) {
    case 'Bash':
      return input.description || input.command || '';
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return base(input.file_path || input.notebook_path);
    case 'Grep':
      return `"${input.pattern || ''}"${input.path ? ' in ' + base(input.path) : ''}`;
    case 'Glob':
      return input.pattern || '';
    case 'WebFetch':
      return input.url || '';
    case 'WebSearch':
      return input.query || '';
    case 'Task':
    case 'Agent':
      return input.description || input.subagent_type || '';
    case 'TodoWrite':
      return `${(input.todos || []).length} todos`;
    case 'AskUserQuestion':
      return (input.questions && input.questions[0] && input.questions[0].question) || '';
    default: {
      const s = JSON.stringify(input);
      return s && s !== '{}' ? s : '';
    }
  }
}

/** Grab the last thing the assistant said from a Claude Code transcript (JSONL). */
function lastAssistantText(transcriptPath) {
  if (!transcriptPath) return '';
  try {
    const fd = fs.openSync(transcriptPath, 'r');
    const { size } = fs.fstatSync(fd);
    const len = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n').reverse();
    for (const line of lines) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      const msg = row.message;
      if (row.type !== 'assistant' || !msg || !Array.isArray(msg.content)) continue;
      const text = msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
      if (text) return text;
    }
  } catch {}
  return '';
}

class SessionStore extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();
    this.pending = new Map(); // requestId -> { sessionId, kind, resolve }
    this.seq = 0;
  }

  get(id, input = {}) {
    let s = this.sessions.get(id);
    if (!s) {
      const cwd = input.cwd || '';
      s = {
        id,
        cwd,
        name: cwd ? path.basename(cwd) : id.slice(0, 8),
        status: 'idle', // working | needs-you | idle | ended
        startedAt: Date.now(),
        lastActivity: Date.now(),
        steps: [],
        pending: null,
        lastMessage: '',
        editor: null,
      };
      this.sessions.set(id, s);
    }
    if (input.cwd && !s.cwd) {
      s.cwd = input.cwd;
      s.name = path.basename(input.cwd);
    }
    return s;
  }

  addStep(s, step) {
    s.steps.push({ id: ++this.seq, at: Date.now(), ...step });
    if (s.steps.length > MAX_STEPS) s.steps.splice(0, s.steps.length - MAX_STEPS);
  }

  /**
   * Handle a hook event. Returns a Promise resolving to the hook output
   * (object or null) for blocking events, or null right away otherwise.
   */
  handle(input, meta = {}) {
    const ev = input.hook_event_name;
    const id = input.session_id || 'unknown';
    const s = this.get(id, input);
    s.lastActivity = Date.now();
    if (meta.editor) s.editor = meta.editor;
    if (s.status === 'ended' && ev !== 'SessionEnd') s.status = 'idle';

    let result = null;

    switch (ev) {
      case 'SessionStart':
        this.addStep(s, { type: 'session', text: `Session ${input.source || 'started'}` });
        break;

      case 'UserPromptSubmit':
        s.status = 'working';
        this.addStep(s, { type: 'prompt', text: input.prompt || '' });
        break;

      case 'PreToolUse': {
        s.status = 'working';
        this.addStep(s, {
          type: 'tool',
          tool: input.tool_name,
          text: summarizeTool(input.tool_name, input.tool_input),
          toolUseId: input.tool_use_id,
          state: 'running',
        });
        if (input.tool_name === 'AskUserQuestion' && meta.wait) {
          result = this.waitFor(s, {
            kind: 'question',
            questions: (input.tool_input && input.tool_input.questions) || [],
            toolInput: input.tool_input || {},
          });
        }
        break;
      }

      case 'PostToolUse':
      case 'PostToolUseFailure': {
        const step = [...s.steps].reverse().find(
          (st) => st.type === 'tool' && st.state === 'running' &&
            (input.tool_use_id ? st.toolUseId === input.tool_use_id : st.tool === input.tool_name)
        );
        if (step) step.state = ev === 'PostToolUse' ? 'done' : 'failed';
        break;
      }

      case 'PermissionRequest': {
        // AskUserQuestion is handled via PreToolUse, don't double-prompt.
        if (input.tool_name === 'AskUserQuestion') break;
        if (meta.wait) {
          result = this.waitFor(s, {
            kind: 'permission',
            tool: input.tool_name,
            text: summarizeTool(input.tool_name, input.tool_input),
            detail: input.tool_input || {},
          });
        }
        break;
      }

      case 'Notification': {
        const type = input.notification_type || '';
        if (type === 'idle_prompt') {
          if (!s.pending) s.status = 'idle';
        } else if (!s.pending && /permission|waiting|input/i.test(input.message || '')) {
          s.status = 'needs-you';
        }
        this.addStep(s, { type: 'note', text: input.message || type });
        break;
      }

      case 'Stop':
        s.status = 'idle';
        this.markRunningDone(s);
        s.lastMessage = lastAssistantText(input.transcript_path) || s.lastMessage;
        this.addStep(s, { type: 'stop', text: s.lastMessage || 'Finished' });
        break;

      case 'SubagentStop':
        this.addStep(s, { type: 'note', text: 'Sub-agent finished' });
        break;

      case 'SessionEnd':
        s.status = 'ended';
        this.markRunningDone(s);
        this.cancelPending(s);
        this.addStep(s, { type: 'session', text: `Session ended${input.reason ? ' (' + input.reason + ')' : ''}` });
        break;

      default:
        break;
    }

    this.changed();
    return result;
  }

  markRunningDone(s) {
    for (const st of s.steps) if (st.state === 'running') st.state = 'done';
  }

  waitFor(s, pending) {
    // Only one blocking request per session at a time; a newer one wins.
    this.cancelPending(s);
    const requestId = `r${++this.seq}`;
    s.pending = { requestId, ...pending, at: Date.now() };
    s.status = 'needs-you';
    this.emit('attention', s);
    return new Promise((resolve) => {
      this.pending.set(requestId, { sessionId: s.id, kind: pending.kind, toolInput: pending.toolInput, resolve });
    });
  }

  /** Called when the hook process disconnected or timed out before a decision. */
  abandon(requestId) {
    const p = this.pending.get(requestId);
    if (!p) return;
    this.pending.delete(requestId);
    const s = this.sessions.get(p.sessionId);
    if (s && s.pending && s.pending.requestId === requestId) {
      s.pending = null;
      if (s.status === 'needs-you') s.status = 'working';
    }
    this.changed();
  }

  cancelPending(s) {
    if (!s.pending) return;
    const p = this.pending.get(s.pending.requestId);
    if (p) {
      this.pending.delete(s.pending.requestId);
      p.resolve(null); // fall back to the editor's own prompt
    }
    s.pending = null;
  }

  /**
   * decision: { action: 'allow' | 'deny' | 'defer' | 'answer', answers?, message? }
   */
  decide(requestId, decision) {
    const p = this.pending.get(requestId);
    if (!p) return false;
    this.pending.delete(requestId);
    const s = this.sessions.get(p.sessionId);
    let output = null;

    if (p.kind === 'permission') {
      if (decision.action === 'allow') {
        output = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } };
      } else if (decision.action === 'deny') {
        output = {
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: { behavior: 'deny', message: decision.message || 'Denied from Buddybar.' },
          },
        };
      }
    } else if (p.kind === 'question' && decision.action === 'answer') {
      output = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: 'Answered from Buddybar',
          updatedInput: { ...(p.toolInput || {}), answers: decision.answers || {} },
        },
      };
    }

    if (s) {
      if (s.pending && s.pending.requestId === requestId) s.pending = null;
      s.status = 'working';
      const label =
        decision.action === 'answer'
          ? 'You answered: ' + Object.values(decision.answers || {}).join(', ')
          : decision.action === 'allow' ? 'You allowed it'
          : decision.action === 'deny' ? 'You denied it'
          : 'Sent back to the editor';
      this.addStep(s, { type: 'you', text: label });
    }
    p.resolve(output);
    this.changed();
    return true;
  }

  dismiss(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    this.cancelPending(s);
    this.sessions.delete(id);
    this.changed();
  }

  snapshot() {
    return [...this.sessions.values()]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((s) => ({ ...s, steps: s.steps.slice(-80) }));
  }

  changed() {
    this.emit('change');
  }
}

module.exports = { SessionStore, summarizeTool, lastAssistantText };
