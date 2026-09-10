import assert from 'node:assert/strict';
import type { TeamInfo } from '../src/types';
import {
  findWorsenedTeamNameConflict,
  normalizeTeamDirectoryName,
  resolveUniqueTeamByDirectoryName,
} from '../src/utils/teamDirectoryIntegrity';

const team = (id: string, name: string): TeamInfo => ({
  id,
  name,
  leader: name,
  defaultCount: 1,
} as TeamInfo);

assert.equal(normalizeTeamDirectoryName('  ĐỘI Nguyên  '), 'đội nguyên');

const clean = [team('a', 'Đội Nguyên'), team('b', 'Đội An')];
const introducedDuplicate = [...clean, team('c', '  đội nguyên  ')];
const introduced = findWorsenedTeamNameConflict(clean, introducedDuplicate);
assert.ok(introduced, 'Adding a case-insensitive duplicate team name must be rejected');
assert.equal(introduced?.normalizedName, 'đội nguyên');
assert.equal(introduced?.previousCount, 1);
assert.equal(introduced?.nextCount, 2);

const legacyDuplicate = [team('a', 'Đội Nguyên'), team('c', 'đội nguyên'), team('b', 'Đội An')];
assert.equal(
  findWorsenedTeamNameConflict(legacyDuplicate, legacyDuplicate),
  null,
  'Unchanged legacy duplicates must not be rewritten or block unrelated saves',
);
assert.equal(
  findWorsenedTeamNameConflict(legacyDuplicate, [team('a', 'Đội Nguyên'), team('b', 'Đội An')]),
  null,
  'Reducing a legacy duplicate must be allowed',
);
assert.ok(
  findWorsenedTeamNameConflict(legacyDuplicate, [...legacyDuplicate, team('d', 'Đội Nguyên')]),
  'Increasing an existing duplicate count must be rejected',
);

assert.equal(resolveUniqueTeamByDirectoryName(clean, 'đội nguyên')?.id, 'a');
assert.equal(
  resolveUniqueTeamByDirectoryName(legacyDuplicate, 'Đội Nguyên'),
  undefined,
  'A duplicated display name must never be guessed into a teamId',
);
assert.equal(resolveUniqueTeamByDirectoryName(clean, ''), undefined);

console.log('PASS team-directory-integrity-golden');


const crewSource = await import('node:fs').then(({ readFileSync }) => readFileSync('src/components/CrewTabBase.tsx', 'utf8'));
assert.match(crewSource, /findWorsenedTeamNameConflict\(teams, nextTeams\)/, 'CrewTabBase must validate before local mutation');
assert.match(crewSource, /if \(!updateTeamsAndParent\(nextTeams\)\) return;/, 'Team form/delete flows must stop on rejected write');
assert.match(crewSource, /if \(!updateTeamsAndParent\(newTeams\)\) return;/, 'Excel import must not report success after rejected write');
assert.doesNotMatch(crewSource, /key={`crew-directory-/, 'Integrity guard must not remount the whole Crew UI');

assert.match(crewSource, /resolveUniqueTeamByDirectoryName\(teams, teamName\)/, 'Crew save must fail closed on ambiguous legacy names');
assert.doesNotMatch(crewSource, /teams\.find\(t => t\.name\.trim\(\)\.toLowerCase\(\) === teamName/, 'Crew save must never pick the first display-name match');
assert.match(crewSource, /matchingIndices\.length > 1/, 'Excel import must detect ambiguous legacy team names');
assert.match(crewSource, /normalizeTeamDirectoryName\(nameStr\)/, 'Excel team matching must use the canonical normalizer');
