/**
 * Unit Tests for OpenNutrition Client
 * File: api/__tests__/opennutrition-client.test.js
 * 
 * Tests the 5 conversions as specified:
 * 1. Rice (dry → cooked)
 * 2. Pasta (dry → cooked)
 * 3. Oats (dry → cooked)
 * 4. Chicken (raw → cooked)
 * 5. Salmon (raw → cooked)
 * 
 * Run: npm test api/__tests__/opennutrition-client.test.js
 */

const { getClient } = require('../opennutrition-client.js');

// Test timeouts
jest.setTimeout(30000); // 30 seconds for server startup

describe('OpenNutrition Client - Basic Functionality', () => {
  let client;

  beforeAll(async () => {
    console.log('[TEST] Starting OpenNutrition client...');
    client = getClient();
    await client.start();
    console.log('[TEST] Client started');
  });

  afterAll(() => {
    console.log('[TEST] Shutting down client...');
    if (client) {
      client.shutdown();
    }
  });

  describe('Health Check', () => {
    test('client is healthy', async () => {
      const health = await client.healthCheck();
      expect(health.status).toBe('healthy');
      expect(health.isReady).toBe(true);
    });
  });

  describe('Basic Search', () => {
    test('search returns results', async () => {
      const results = await client.searchByName('chicken');
      expect(results).toBeTruthy();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });

    test('search with no results', async () => {
      const results = await client.searchByName('xyznonexistentfood123');
      expect(results).toBeTruthy();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
  });

  describe('Transform to Cheffy Format', () => {
    test('valid transformation', () => {
      const onData = {
        id: 12345,
        name: 'Test Food',
        ean_13: '1234567890123',
        nutrition_100g: {
          energy_kcal: 200,
          protein_g: 10,
          fat_g: 5,
          carbohydrate_g: 30,
          fiber_g: 3,
          sugar_g: 2,
          sodium_mg: 100
        },
        labels: ['organic'],
        source: {
          name: 'USDA',
          url: 'https://usda.gov'
        }
      };

      const transformed = client.transformToCheffyFormat(onData);
      
      expect(transformed).toBeTruthy();
      expect(transformed.status).toBe('found');
      expect(transformed.source).toBe('OPENNUTRITION');
      expect(transformed.servingUnit).toBe('100g');
      expect(transformed.calories).toBe(200);
      expect(transformed.protein).toBe(10);
      expect(transformed.fat).toBe(5);
      expect(transformed.carbs).toBe(30);
      expect(transformed.fiber).toBe(3);
      expect(transformed.sugar).toBe(2);
      expect(transformed.sodium).toBe(100);
      expect(transformed.name).toBe('Test Food');
      expect(transformed.barcode).toBe('1234567890123');
      expect(transformed.labels).toEqual(['organic']);
      expect(transformed._source_name).toBe('USDA');
    });

    test('handles missing fields gracefully', () => {
      const onData = {
        id: 999,
        name: 'Minimal Food',
        nutrition_100g: {
          energy_kcal: 100,
          protein_g: 5
          // Missing: fat, carbs, fiber, etc.
        }
      };

      const transformed = client.transformToCheffyFormat(onData);
      
      expect(transformed).toBeTruthy();
      expect(transformed.calories).toBe(100);
      expect(transformed.protein).toBe(5);
      expect(transformed.fat).toBe(0); // Fallback
      expect(transformed.carbs).toBe(0); // Fallback
      expect(transformed.fiber).toBe(0); // Fallback
    });
  });
});

describe('OpenNutrition Client - 5 Required Conversions', () => {
  let client;

  beforeAll(async () => {
    client = getClient();
    await client.start();
  });

  afterAll(() => {
    if (client) {
      client.shutdown();
    }
  });

  /**
   * Test 1: Rice (Dry → Cooked)
   * 
   * Expectation: Dry rice has ~130 kcal/100g, cooked rice has ~370 kcal/100g
   * Dry rice absorbs water (3x weight gain), so nutrients become more concentrated
   */
  describe('Conversion Test 1: Rice', () => {
    test('white rice - dry', async () => {
      const results = await client.searchByName('white rice dry');
      expect(results).toBeTruthy();
      expect(results.length).toBeGreaterThan(0);

      const rice = results[0];
      expect(rice.nutrition_100g).toBeDefined();
      
      const transformed = client.transformToCheffyFormat(rice);
      
      // Dry rice: ~360-380 kcal/100g, ~7-8g protein, ~78-80g carbs
      expect(transformed.calories).toBeGreaterThan(300);
      expect(transformed.calories).toBeLessThan(400);
      expect(transformed.protein).toBeGreaterThan(5);
      expect(transformed.carbs).toBeGreaterThan(70);
      
      console.log(`[TEST] Rice (dry): ${transformed.calories} kcal, ${transformed.protein}g protein, ${transformed.carbs}g carbs per 100g`);
    });

    test('white rice - cooked', async () => {
      const results = await client.searchByName('white rice cooked');
      expect(results).toBeTruthy();
      expect(results.length).toBeGreaterThan(0);

      const rice = results[0];
      const transformed = client.transformToCheffyFormat(rice);
      
      // Cooked rice: ~110-140 kcal/100g (due to water absorption)
      expect(transformed.calories).toBeGreaterThan(90);
      expect(transformed.calories).toBeLessThan(160);
      expect(transformed.protein).toBeGreaterThan(1);
      expect(transformed.carbs).toBeGreaterThan(20);
      
      console.log(`[TEST] Rice (cooked): ${transformed.calories} kcal, ${transformed.protein}g protein, ${transformed.carbs}g carbs per 100g`);
    });
  });

  /**
   * Test 2: Pasta (Dry → Cooked)
   * 
   * Expectation: Dry pasta ~350 kcal/100g, cooked pasta ~130 kcal/100g
   */
  describe('Conversion Test 2: Pasta', () => {
    test('pasta - dry', async () => {
      const results = await client.searchByName('pasta dry');
      expect(results).toBeTruthy();
      expect(results.length).toBeGreaterThan(0);

      const pasta = results[0];
      const transformed = client.transformToCheffyFormat(pasta);
      
      // Dry pasta: ~350-370 kcal/100g, ~12-14g protein, ~70-75g carbs
      expect(transformed.calories).toBeGreaterThan(300);
      expect(transformed.calories).toBeLessThan(400);
      expect(transformed.protein).toBeGreaterThan(10);
      expect(transformed.carbs).toBeGreaterThan(65);
      
      console.log(`[TEST] Pasta (dry): ${transformed.calories} kcal, ${transformed.protein}g protein, ${transformed.carbs}g carbs per 100g`);
    });

    test('pasta - cooked', async () => {
      const results = await client.searchByName('pasta cooked');
      expect(results).toBeTruthy();
      expect(results.length).toBeGreaterThan(0);

      const pasta = results[0];
      const transformed = client.transformToCheffyFormat(pasta);
      
      // Cooked pasta: ~120-160 kcal/100g
      expect(transformed.calories).toBeGreaterThan(100);
      expect(transformed.calories).toBeLessThan(180);
      expect(transformed.protein).toBeGreaterThan(3);
      expect(transformed.carbs).toBeGreaterThan(20);
      
      console.log(`[TEST] Pasta (cooked): ${transformed.calories} kcal, ${transformed.protein}g protein, ${transformed.carbs}g carbs per 100g`);
    });
  });

  /**
   * Test 3: Oats (Dry → Cooked)
   * 
   * Expectation: Dry oats ~370 kcal/100g, cooked oats ~70 kcal/100g
   */
  describe('Conversion Test 3: Oats', () => {
    test('rolled oats - dry', async () => {
      const results = await client.searchByName('rolled oats dry');
      expect(results).toBeTruthy();
      expect(results.length).toBeGreaterThan(0);

      const oats = results[0];
      const transformed = client.transformToCheffyFormat(oats);
      
      // Dry oats: ~360-380 kcal/100g, ~13-17g protein, ~10-11g fiber
      expect(transformed.calories).toBeGreaterThan(330);
      expect(transformed.calories).toBeLessThan(400);
      expect(transformed.protein).toBeGreaterThan(10);
      expect(transformed.fiber).toBeGreaterThan(8);
      
      console.log(`[TEST] Oats (dry): ${transformed.calories} kcal, ${transformed.protein}g protein, ${transformed.fiber}g fiber per 100g`);
    });

    test('oatmeal - cooked', async () => {
      const results = await client.searchByName('oatmeal cooked');
      expect(results).toBeTruthy();
      expect(results.length).toBeGreaterThan(0);

      const oats = results[0];
      const transformed = client.transformToCheffyFormat(oats);
      
      // Cooked oatmeal: ~60-80 kcal/100g (huge water absorption)
      expect(transformed.calories).toBeGreaterThan(50);
      expect(transformed.calories).toBeLessThan(100);
      expect(transformed.protein).toBeGreaterThan(1);
      
      console.log(`[TEST] Oats (cooked): ${transformed.calories} kcal, ${transformed.protein}g protein per 100g`);
    });
  });

  /**
   * Test 4: Chicken (Raw → Cooked)
   * 
   * Expectation: Raw chicken breast ~120 kcal/100g, cooked ~165 kcal/100g
   * (Due to water loss during cooking)
   */
  describe('Conversion Test 4: Chicken', () => {
    test('chicken breast - raw', async () => {
      const results = await client.searchByName('chicken breast raw');
      expect(results).toBeTruthy();
      expect(results.length).toBeGreaterThan(0);

      const chicken = results[0];
      const transformed = client.transformToCheffyFormat(chicken);
      
      // Raw chicken breast: ~110-130 kcal/100g, ~22-24g protein
      expect(transformed.calories).toBeGreaterThan(100);
      expect(transformed.calories).toBeLessThan(150);
      expect(transformed.protein).toBeGreaterThan(20);
      expect(transformed.protein).toBeLessThan(26);
      expect(transformed.fat).toBeLessThan(5); // Lean
      
      console.log(`[TEST] Chicken (raw): ${transformed.calories} kcal, ${transformed.protein}g protein, ${transformed.fat}g fat per 100g`);
    });

    test('chicken breast - cooked', async () => {
      const results = await client.searchByName('chicken breast cooked');
      expect(results).toBeTruthy();
      expect(results.length).toBeGreaterThan(0);

      const chicken = results[0];
      const transformed = client.transformToCheffyFormat(chicken);
      
      // Cooked chicken breast: ~150-175 kcal/100g (water loss concentrates nutrients)
      expect(transformed.calories).toBeGreaterThan(140);
      expect(transformed.calories).toBeLessThan(200);
      expect(transformed.protein).toBeGreaterThan(28);
      expect(transformed.protein).toBeLessThan(35);
      
      console.log(`[TEST] Chicken (cooked): ${transformed.calories} kcal, ${transformed.protein}g protein per 100g`);
    });
  });

  /**
   * Test 5: Salmon (Raw → Cooked)
   * 
   * Expectation: Raw salmon ~140 kcal/100g, cooked salmon ~200 kcal/100g
   */
  describe('Conversion Test 5: Salmon', () => {
    test('atlantic salmon - raw', async () => {
      const results = await client.searchByName('atlantic salmon raw');
      expect(results).toBeTruthy();
      expect(results.length).toBeGreaterThan(0);

      const salmon = results[0];
      const transformed = client.transformToCheffyFormat(salmon);
      
      // Raw salmon: ~140-160 kcal/100g, ~20-22g protein, ~6-8g fat (omega-3 rich)
      expect(transformed.calories).toBeGreaterThan(120);
      expect(transformed.calories).toBeLessThan(180);
      expect(transformed.protein).toBeGreaterThan(18);
      expect(transformed.fat).toBeGreaterThan(5);
      expect(transformed.fat).toBeLessThan(12);
      
      console.log(`[TEST] Salmon (raw): ${transformed.calories} kcal, ${transformed.protein}g protein, ${transformed.fat}g fat per 100g`);
    });

    test('atlantic salmon - cooked', async () => {
      const results = await client.searchByName('atlantic salmon cooked');
      expect(results).toBeTruthy();
      expect(results.length).toBeGreaterThan(0);

      const salmon = results[0];
      const transformed = client.transformToCheffyFormat(salmon);
      
      // Cooked salmon: ~180-220 kcal/100g (water loss concentrates fat + protein)
      expect(transformed.calories).toBeGreaterThan(160);
      expect(transformed.calories).toBeLessThan(250);
      expect(transformed.protein).toBeGreaterThan(22);
      expect(transformed.fat).toBeGreaterThan(8);
      
      console.log(`[TEST] Salmon (cooked): ${transformed.calories} kcal, ${transformed.protein}g protein, ${transformed.fat}g fat per 100g`);
    });
  });
});

describe('OpenNutrition Client - Performance', () => {
  let client;

  beforeAll(async () => {
    client = getClient();
    await client.start();
  });

  afterAll(() => {
    if (client) {
      client.shutdown();
    }
  });

  test('single search latency < 150ms (p95)', async () => {
    const iterations = 20;
    const latencies = [];

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await client.searchByName('chicken');
      const latency = Date.now() - start;
      latencies.push(latency);
    }

    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(iterations * 0.95)];
    const median = latencies[Math.floor(iterations * 0.5)];

    console.log(`[PERF] Search latency - p50: ${median}ms, p95: ${p95}ms`);
    
    expect(p95).toBeLessThan(150);
    expect(median).toBeLessThan(100);
  });

  test('batch search efficiency', async () => {
    const queries = ['chicken', 'rice', 'pasta', 'salmon', 'broccoli'];
    
    const start = Date.now();
    const results = await client.batchSearch(queries);
    const totalTime = Date.now() - start;

    console.log(`[PERF] Batch search (${queries.length} items): ${totalTime}ms`);
    
    expect(results.length).toBe(queries.length);
    expect(totalTime).toBeLessThan(500); // Should be faster than sequential
    
    // Check all queries succeeded
    const successCount = results.filter(r => r.result && r.result.length > 0).length;
    expect(successCount).toBeGreaterThanOrEqual(queries.length - 1); // Allow 1 miss
  });

  test('cache effectiveness', async () => {
    // First query (cold)
    const start1 = Date.now();
    await client.searchByName('chicken breast');
    const coldLatency = Date.now() - start1;

    // Second query (warm cache)
    const start2 = Date.now();
    await client.searchByName('chicken breast');
    const warmLatency = Date.now() - start2;

    console.log(`[PERF] Cache - Cold: ${coldLatency}ms, Warm: ${warmLatency}ms`);
    
    // Warm should be significantly faster
    expect(warmLatency).toBeLessThan(coldLatency * 0.5);
    expect(warmLatency).toBeLessThan(10); // Near-instant from cache
  });
});