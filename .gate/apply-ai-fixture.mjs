import fs from 'node:fs';

const path = 'scripts/ai-external-context-golden.ts';
const text = fs.readFileSync(path, 'utf8');

const oldText = "workVolumes: [{ id: 'wv1', title: 'Trần', floorId: 'f1', floor: 'Tầng 1', category: 'Trần thạch cao', unit: 'm2', planned: 9000, actual: 4000, status: 'Đang thi công' }],";
const newText = "workVolumes: [{ id: 'wv1', workCategoryId: 'cat-ceiling', title: 'Trần', floorId: 'f1', floor: 'Tầng 1', category: 'Trần thạch cao', unit: 'm2', planned: 9000, actual: 4000, status: 'Đang thi công' }],";

const count = text.split(oldText).length - 1;
if (count !== 1) throw new Error(`Expected exactly one legacy fixture WorkVolume, found ${count}`);
fs.writeFileSync(path, text.replace(oldText, newText));
console.log('Applied AI active-category fixture patch.');
