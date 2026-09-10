from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    return text.replace(old, new, 1)

path = Path('src/components/CrewTabBase.tsx')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    "import { findWorsenedTeamNameConflict } from '../utils/teamDirectoryIntegrity';",
    "import { findWorsenedTeamNameConflict, normalizeTeamDirectoryName, resolveUniqueTeamByDirectoryName } from '../utils/teamDirectoryIntegrity';",
    'team integrity imports',
)
text = replace_once(
    text,
    "    const matchingTeam = teams.find(t => t.name.trim().toLowerCase() === teamName.trim().toLowerCase());\n    const finalTeamId = teamId || matchingTeam?.id || '';",
    "    // Explicit teamId is authoritative. Legacy display-name fallback is allowed only\n    // when the current directory has exactly one matching team. Never guess the first\n    // duplicate, otherwise Crew/Material Need attribution can drift to the wrong team.\n    const matchingTeam = resolveUniqueTeamByDirectoryName(teams, teamName);\n    const finalTeamId = teamId || matchingTeam?.id || '';",
    'crew record teamId resolver',
)
text = replace_once(
    text,
    """          const existingIdx = rawTeamId 
            ? newTeams.findIndex(t => t.id === rawTeamId)
            : newTeams.findIndex(t => t.name.toLowerCase() === nameStr.toLowerCase());

          const teamData: TeamInfo = {""",
    """          let existingIdx = -1;
          if (rawTeamId) {
            existingIdx = newTeams.findIndex(t => t.id === rawTeamId);
          } else {
            const normalizedName = normalizeTeamDirectoryName(nameStr);
            const matchingIndices = newTeams
              .map((team, index) => normalizeTeamDirectoryName(team.name) === normalizedName ? index : -1)
              .filter((index) => index >= 0);
            if (matchingIndices.length > 1) {
              // Legacy duplicate names are ambiguous without __teamId. Do not silently
              // update the first team; skip this row and require an exported ID-based file.
              skippedCount++;
              return;
            }
            existingIdx = matchingIndices[0] ?? -1;
          }

          const teamData: TeamInfo = {""",
    'Excel ambiguous team match',
)
text = replace_once(
    text,
    "          `• Bỏ qua do thiếu thông tin bắt buộc (Tên đội, Đội trưởng hoặc Quân số > 0): ${skippedCount} dòng`",
    "          `• Bỏ qua do thiếu thông tin hoặc tên đội legacy bị trùng/không đủ teamId: ${skippedCount} dòng`",
    'Excel import summary',
)
path.write_text(text, encoding='utf-8')

path = Path('scripts/team-directory-integrity-golden.ts')
text = path.read_text(encoding='utf-8')
extra = """
assert.match(crewSource, /resolveUniqueTeamByDirectoryName\(teams, teamName\)/, 'Crew save must fail closed on ambiguous legacy names');
assert.doesNotMatch(crewSource, /teams\.find\(t => t\.name\.trim\(\)\.toLowerCase\(\) === teamName/, 'Crew save must never pick the first display-name match');
assert.match(crewSource, /matchingIndices\.length > 1/, 'Excel import must detect ambiguous legacy team names');
assert.match(crewSource, /normalizeTeamDirectoryName\(nameStr\)/, 'Excel team matching must use the canonical normalizer');
"""
if 'Crew save must fail closed on ambiguous legacy names' not in text:
    text += extra
path.write_text(text, encoding='utf-8')
print('teamId fail-closed audit patch applied')
