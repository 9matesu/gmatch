const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'test-results', 'wcag-findings.json');
const findings = JSON.parse(fs.readFileSync(filePath, 'utf8'));

console.log('Total views audited:', findings.length);

const summary = {};
const viewSummaries = {};

for (const v of findings) {
  viewSummaries[v.view] = { HIGH: 0, MEDIUM: 0, LOW: 0, total: v.violations.length };
  for (const item of v.violations) {
    summary[item.rule] = summary[item.rule] || { HIGH: 0, MEDIUM: 0, LOW: 0, count: 0, examples: [] };
    summary[item.rule][item.severity]++;
    summary[item.rule].count++;
    viewSummaries[v.view][item.severity]++;
    if (summary[item.rule].examples.length < 3) {
      summary[item.rule].examples.push({ view: v.view, selector: item.selector, desc: item.description, details: item.details });
    }
  }
}

console.log('\n--- BY RULE ---');
for (const [rule, data] of Object.entries(summary)) {
  console.log(`${rule}: Total=${data.count} (HIGH=${data.HIGH}, MED=${data.MEDIUM}, LOW=${data.LOW})`);
  for (const ex of data.examples) {
    console.log(`   [${ex.view}] ${ex.selector} -> ${ex.desc}`);
  }
}

console.log('\n--- BY VIEW ---');
console.table(viewSummaries);
