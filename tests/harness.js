// Tiny test harness: define test/expect and render results
(function(){
  const results = [];
  function expect(received){
    return {
      toBe(expected){
        const pass = Object.is(received, expected);
        results.push({ pass, msg: pass ? `OK: ${received} === ${expected}` : `FAIL: ${received} !== ${expected}` });
      },
      toEqual(expected){
        const rec = JSON.stringify(received);
        const exp = JSON.stringify(expected);
        const pass = rec === exp;
        results.push({ pass, msg: pass ? `OK: ${rec} === ${exp}` : `FAIL: ${rec} !== ${exp}` });
      },
      toBeGreaterThan(n){
        const pass = received > n; results.push({ pass, msg: pass ? `OK: ${received} > ${n}` : `FAIL: ${received} <= ${n}` });
      }
    };
  }
  function test(name, fn){
    try { fn(); console.log(`✔ ${name}`); }
    catch(e){ console.error(`✘ ${name}`, e); results.push({ pass:false, msg: `${name} threw ${e}` }); }
  }
  function render(){
    const el = document.getElementById('test-output');
    if(!el) return;
    const passed = results.filter(r=>r.pass).length;
    const failed = results.length - passed;
    const header = document.createElement('div');
    header.textContent = `Passed: ${passed}, Failed: ${failed}`;
    header.style.marginBottom = '8px';
    el.appendChild(header);
    for(const r of results){
      const li = document.createElement('div');
      li.textContent = r.msg;
      li.style.color = r.pass ? '#16a34a' : '#ef4444';
      el.appendChild(li);
    }
  }
  window.expect = expect;
  window.test = test;
  window.__renderResults = render;
})();

