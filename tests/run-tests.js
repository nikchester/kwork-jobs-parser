const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'Code.js'), 'utf8');
const context = {
  console,
  Date,
  isNaN,
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty() {
          return null;
        }
      };
    }
  },
  Session: {
    getScriptTimeZone() {
      return 'UTC';
    }
  },
  Utilities: {
    formatDate(date) {
      return date.toISOString();
    },
    sleep() {}
  }
};

vm.createContext(context);
vm.runInContext(code, context, { filename: 'Code.js' });

function config(overrides = {}) {
  return Object.assign({
    minBudgetRub: 0,
    maxBudgetRub: 0,
    requiredKeywords: [],
    excludedKeywords: [],
    buyerHistoryFilterMode: 'mark',
    minBuyerProjects: 10,
    minBuyerHiredPercent: 35
  }, overrides);
}

function project(overrides = {}) {
  return Object.assign({
    title: 'Test project',
    normalizedText: 'test project',
    budgetRub: 1000,
    buyerName: 'buyer',
    buyerProjectsText: '10 проектов на бирже',
    buyerHiredText: '35% нанял',
    buyerProjectsCount: 10,
    buyerHiredPercent: 35
  }, overrides);
}

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('off mode preserves existing behavior for risky buyer history', () => {
  const result = context.matchesFilters_(project({
    buyerProjectsCount: 3,
    buyerHiredPercent: 20
  }), config({ buyerHistoryFilterMode: 'off' }));

  assert.strictEqual(result, true);
});

test('mark mode keeps risky buyer and reports a warning', () => {
  const risky = project({
    buyerProjectsCount: 3,
    buyerHiredPercent: 20.5
  });

  assert.strictEqual(context.matchesFilters_(risky, config({ buyerHistoryFilterMode: 'mark' })), true);
  assert.strictEqual(
    context.evaluateBuyerHistory_(risky, config({ buyerHistoryFilterMode: 'mark' })).warning,
    '⚠ ниже порога: проектов 3 < 10, нанял 20,5% < 35%'
  );
});

test('strict mode rejects known buyer history below thresholds', () => {
  const result = context.matchesFilters_(project({
    buyerProjectsCount: 3,
    buyerHiredPercent: 20
  }), config({ buyerHistoryFilterMode: 'strict' }));

  assert.strictEqual(result, false);
});

test('thresholds are inclusive', () => {
  const result = context.matchesFilters_(project({
    buyerProjectsCount: 10,
    buyerHiredPercent: 35
  }), config({ buyerHistoryFilterMode: 'strict' }));

  assert.strictEqual(result, true);
});

test('strict mode checks only known projects field when hired percent is unknown', () => {
  assert.strictEqual(context.matchesFilters_(project({
    buyerProjectsCount: 3,
    buyerHiredPercent: null
  }), config({ buyerHistoryFilterMode: 'strict' })), false);

  assert.strictEqual(context.matchesFilters_(project({
    buyerProjectsCount: 12,
    buyerHiredPercent: null
  }), config({ buyerHistoryFilterMode: 'strict' })), true);
});

test('strict mode checks only known hired percent field when projects count is unknown', () => {
  assert.strictEqual(context.matchesFilters_(project({
    buyerProjectsCount: null,
    buyerHiredPercent: 20
  }), config({ buyerHistoryFilterMode: 'strict' })), false);

  assert.strictEqual(context.matchesFilters_(project({
    buyerProjectsCount: null,
    buyerHiredPercent: 40
  }), config({ buyerHistoryFilterMode: 'strict' })), true);
});

test('unknown buyer history is filtered out in strict mode', () => {
  const unknown = project({
    buyerProjectsText: '',
    buyerHiredText: '',
    buyerProjectsCount: null,
    buyerHiredPercent: null
  });
  const result = context.evaluateBuyerHistory_(unknown, config({ buyerHistoryFilterMode: 'strict' }));

  assert.strictEqual(result.passes, false);
  assert.strictEqual(result.warning, '⚠ история заказчика не распознана');
  assert.strictEqual(context.matchesFilters_(unknown, config({ buyerHistoryFilterMode: 'strict' })), false);
});

test('parses buyer history values from Russian text', () => {
  assert.strictEqual(context.extractBuyerProjectsCount_('10 проектов на бирже'), 10);
  assert.strictEqual(context.extractBuyerHiredPercent_('35% нанял'), 35);
  assert.strictEqual(context.extractBuyerHiredPercent_('20,5% нанял'), 20.5);
});

test('parses full email fixture rows with buyer history', () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'kwork-email-history.html'), 'utf8');
  const rows = context.extractProjectRows_(html);
  const projects = rows.map((row) => context.parseProjectRow_(row, new Date('2026-09-18T00:00:00Z')));

  assert.strictEqual(rows.length, 3);
  assert.strictEqual(projects[0].buyerProjectsCount, 10);
  assert.strictEqual(projects[0].buyerHiredPercent, 35);
  assert.strictEqual(projects[1].buyerProjectsCount, 3);
  assert.strictEqual(projects[1].buyerHiredPercent, 20.5);
  assert.strictEqual(projects[2].buyerProjectsCount, null);
  assert.strictEqual(projects[2].buyerHiredPercent, null);
});

test('mark mode keeps project with unknown buyer history', () => {
  const unknown = project({
    buyerProjectsText: '',
    buyerHiredText: '',
    buyerProjectsCount: null,
    buyerHiredPercent: null
  });

  assert.strictEqual(context.matchesFilters_(unknown, config({ buyerHistoryFilterMode: 'mark' })), true);
  const card = context.formatProjectCard_(unknown, config({ buyerHistoryFilterMode: 'mark' }));
  assert.match(card, /⚠ история заказчика не распознана/);
});

test('formatProjectCard has no warning for buyer at thresholds', () => {
  const card = context.formatProjectCard_(project({
    buyerProjectsText: '10 проектов на бирже',
    buyerHiredText: '35% нанял',
    buyerProjectsCount: 10,
    buyerHiredPercent: 35
  }), config({ buyerHistoryFilterMode: 'mark' }));

  assert.match(card, /История:/);
  assert.doesNotMatch(card, /⚠/);
});

test('formatProjectCard shows warning for risky buyer in mark mode', () => {
  const card = context.formatProjectCard_(project({
    buyerProjectsText: '2 проекта на бирже',
    buyerHiredText: '',
    buyerProjectsCount: 2,
    buyerHiredPercent: null
  }), config({ buyerHistoryFilterMode: 'mark' }));

  assert.match(card, /⚠ ниже порога: проектов 2 &lt; 10/);
});

test('formatProjectCard shows no warning in off mode', () => {
  const card = context.formatProjectCard_(project({
    buyerProjectsCount: 2,
    buyerHiredPercent: 10
  }), config({ buyerHistoryFilterMode: 'off' }));

  assert.doesNotMatch(card, /⚠/);
});
