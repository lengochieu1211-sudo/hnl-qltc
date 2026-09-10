from pathlib import Path
import json


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    return text.replace(old, new, 1)

path = Path('src/components/CrewTabBase.tsx')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    "import { UserRole, canEditCrewData, canDeleteBusinessData, canDeleteCrewRecord, canManageTeams, canImportData } from '../utils/securityUtils';\n",
    "import { UserRole, canEditCrewData, canDeleteBusinessData, canDeleteCrewRecord, canManageTeams, canImportData } from '../utils/securityUtils';\nimport { findWorsenedTeamNameConflict } from '../utils/teamDirectoryIntegrity';\n",
    'CrewTabBase team integrity import',
)
text = replace_once(
    text,
    """  // Call onUpdateTeams when teams change
  const updateTeamsAndParent = (nextTeams: TeamInfo[]) => {
    if (!canManageTeamDirectory) return;
    setTeams(nextTeams);
    if (onUpdateTeams) {
      onUpdateTeams(nextTeams);
    }
  };""",
    """  // Validate before mutating local state so a rejected duplicate never appears as saved
  // and no form state needs to be destroyed/remounted to recover.
  const updateTeamsAndParent = (nextTeams: TeamInfo[]): boolean => {
    if (!canManageTeamDirectory) return false;
    const conflict = findWorsenedTeamNameConflict(teams, nextTeams);
    if (conflict) {
      alert(
        `Không thể lưu vì tên đội “${conflict.displayName}” bị trùng. ` +
        'Mỗi tên đội phải đại diện cho một teamId duy nhất. Hãy đổi tên một đội rồi lưu lại.'
      );
      return false;
    }
    setTeams(nextTeams);
    onUpdateTeams?.(nextTeams);
    return true;
  };""",
    'CrewTabBase updateTeamsAndParent',
)
text = replace_once(
    text,
    """    if (editingTeam) {
      nextTeams = teams.map((t) => (t.id === editingTeam.id ? teamData : t));
      setEditingTeam(null);
    } else {
      nextTeams = [...teams, teamData];
    }
    setTeams(nextTeams);
    if (onUpdateTeams) {
      onUpdateTeams(nextTeams);
    }
    setShowTeamModal(false);""",
    """    if (editingTeam) {
      nextTeams = teams.map((t) => (t.id === editingTeam.id ? teamData : t));
    } else {
      nextTeams = [...teams, teamData];
    }
    if (!updateTeamsAndParent(nextTeams)) return;
    setEditingTeam(null);
    setShowTeamModal(false);""",
    'CrewTabBase team submit persistence',
)
text = replace_once(
    text,
    """    if (deletingTeamTarget) {
      const nextTeams = teams.filter((t) => t.id !== deletingTeamTarget.id);
      setTeams(nextTeams);
      if (onUpdateTeams) {
        onUpdateTeams(nextTeams);
      }
      setDeletingTeamTarget(null);
    }""",
    """    if (deletingTeamTarget) {
      const nextTeams = teams.filter((t) => t.id !== deletingTeamTarget.id);
      if (!updateTeamsAndParent(nextTeams)) return;
      setDeletingTeamTarget(null);
    }""",
    'CrewTabBase team delete persistence',
)
text = replace_once(
    text,
    """        updateTeamsAndParent(newTeams);
        alert(
          `🎉 Nhập Đội Thi Công từ Excel thành công!\\n\\n` +""",
    """        if (!updateTeamsAndParent(newTeams)) return;
        alert(
          `🎉 Nhập Đội Thi Công từ Excel thành công!\\n\\n` +""",
    'CrewTabBase Excel import persistence',
)
path.write_text(text, encoding='utf-8')

# Strengthen the regression so the exact safe persistence pattern cannot drift back.
path = Path('scripts/team-directory-integrity-golden.ts')
text = path.read_text(encoding='utf-8')
text += """

const crewSource = await import('node:fs').then(({ readFileSync }) => readFileSync('src/components/CrewTabBase.tsx', 'utf8'));
assert.match(crewSource, /findWorsenedTeamNameConflict\(teams, nextTeams\)/, 'CrewTabBase must validate before local mutation');
assert.match(crewSource, /if \(!updateTeamsAndParent\(nextTeams\)\) return;/, 'Team form/delete flows must stop on rejected write');
assert.match(crewSource, /if \(!updateTeamsAndParent\(newTeams\)\) return;/, 'Excel import must not report success after rejected write');
assert.doesNotMatch(crewSource, /key={`crew-directory-/, 'Integrity guard must not remount the whole Crew UI');
"""
path.write_text(text, encoding='utf-8')

# Wire the focused audit into Stability without touching dependencies/lockfile.
path = Path('package.json')
data = json.loads(path.read_text(encoding='utf-8'))
scripts = data['scripts']
if 'test:team-directory-integrity' not in scripts:
    scripts['test:team-directory-integrity'] = 'tsx scripts/team-directory-integrity-golden.ts'
if 'npm run test:team-directory-integrity' not in scripts['test:stability']:
    scripts['test:stability'] += ' && npm run test:team-directory-integrity'
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('post-PR73 audit patch applied')
