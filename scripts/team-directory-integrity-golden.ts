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
