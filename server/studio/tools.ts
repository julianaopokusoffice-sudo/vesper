import {
  getProject,
  latestProject,
  listMedia,
  projectSummary,
  saveProject,
} from './index.ts';
import type { NativeTool } from '../tools/native.ts';
import type { StudioProject } from '../../shared/types.ts';

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

/**
 * The editor is a data structure, so the agent can reason about a cut the same
 * way it reasons about code. `studio_state` is read-only and cheap; writing a
 * timeline back is approval-gated because it replaces the user's work.
 */
export const STUDIO_TOOLS: NativeTool[] = [
  {
    name: 'studio_state',
    description:
      'Read the current Studio edit: media bin, tracks, every clip’s timeline position, trim and duration, the playhead-relevant total, and the raw project JSON. Use it before advising on a cut or when the user refers to “the timeline”.',
    parameters: obj({ project: { type: 'string', description: 'Optional project id; defaults to the most recently edited' } }),
    async run(args) {
      const project = args.project ? getProject(String(args.project)) : latestProject();
      if (!project) {
        return 'No Studio project has been saved yet. Ask the user to add clips to the timeline in Studio → Edit.';
      }
      const media = listMedia();
      return [
        projectSummary(project),
        '',
        `Media bin (${media.length}):`,
        ...(media.length
          ? media.map((file) => `- ${file.name} (${file.kind}, ${Math.round(file.bytes / 1024)} KB) → ${file.url}`)
          : ['(empty)']),
        '',
        'Raw project JSON:',
        JSON.stringify(project, null, 2).slice(0, 14_000),
      ].join('\n');
    },
  },
  {
    name: 'studio_edit',
    description:
      'Replace a Studio timeline with a new version (tracks, clips, trims, positions). Read it first with studio_state, preserve clip ids and urls, and say what you changed. The user approves the write before it lands; the open editor refreshes within seconds.',
    parameters: obj(
      {
        project: {
          type: 'object',
          description:
            'Complete project: { id, name, width, height, fps, tracks: [{ id, kind: "video"|"overlay", clips: [{ id, name, url, kind, start, in, duration, volume?, muted? }] }] }',
        },
      },
      ['project'],
    ),
    requiresApproval: true,
    approvalReason: (args) => {
      const project = args.project as Partial<StudioProject> | undefined;
      const clips = project?.tracks?.reduce((sum, track) => sum + (track.clips?.length ?? 0), 0) ?? 0;
      return `Replace the Studio timeline “${project?.name ?? 'Untitled edit'}” (${clips} clips on ${project?.tracks?.length ?? 0} tracks)`;
    },
    async run(args) {
      const project = saveProject(args.project as StudioProject);
      return [
        `Saved “${project.name}” (${project.id}).`,
        projectSummary(project),
        'The Studio editor picks this up on its next poll; do not ask the user to reload.',
      ].join('\n');
    },
  },
];
