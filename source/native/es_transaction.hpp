// An iteration may publish rows between seats (B=1). Keep their original values
// once, then restore in place on any exit other than commit. Frozen batches do
// not write values until all additions have been checked. Rollback allocates
// nothing. Rebuild indices only on failure; retained hash capacity stays charged.
struct Update {
  MW &m;
  StateTable &s;
  const size_t states, rows, values, deltas, hashSlots, stateSlots;
  const double bytes;
  const uint32_t dealRng, actionRng;
  struct Undo { size_t row; double value[16]; };
  std::pmr::vector<Undo> undo;
  bool committed = false;
  Update(MW &engine, ScratchBudget &budget) : m(engine), s(m.es->states), states(s.parent.size()),
    rows(m.rows.size()), values(m.vals.size()), deltas(m.delta.size()),
    hashSlots(m.hkeys.size()), stateSlots(s.keys.size()), bytes(m.bytes),
    dealRng(m.rng.state), actionRng(m.es->actionRng.state), undo(&budget) { m.touched.clear(); }
  void touch(size_t row, bool immediate) {
    auto &meta = m.rows[row];
    if (meta.marked) return;
    if (immediate && row < rows) {
      undo.emplace_back();
      undo.back().row = row;
      std::copy_n(m.vals.data() + meta.off, 2 * meta.k, undo.back().value);
    }
    m.touched.push_back((int32_t)row);
    meta.marked = 1;
  }
  void commit() {
    for (auto row : m.touched) m.rows[row].marked = 0;
    committed = true;
  }
  ~Update() {
    if (committed) return;
    for (const auto &u : undo) {
      auto &r = m.rows[u.row];
      std::copy_n(u.value, 2*r.k, m.vals.data()+r.off);
    }
    for (auto row : m.touched) {
      auto &r = m.rows[row];
      if (m.batchDeals > 1) std::fill_n(m.delta.data()+r.off, 2*r.k, 0.0);
      r.marked = 0;
    }
    m.touched.clear();
    m.rows.resize(rows); m.vals.resize(values); m.delta.resize(deltas);
    std::fill(m.hkeys.begin(), m.hkeys.end(), -1);
    for (size_t i=0; i<rows; ++i) {
      const auto key=m.rows[i].key, mask=m.hkeys.size()-1;
      auto j=MW::mix(key)&mask;
      while (m.hkeys[j]!=-1) j=(j+1)&mask;
      m.hkeys[j]=(int64_t)key; m.hrow[j]=(int32_t)i;
    }
    m.hcount=rows;
    s.parent.resize(states); s.slot.resize(states); s.kind.resize(states);
    s.actor.resize(states); s.length.resize(states); s.k.resize(states);
    std::fill(s.keys.begin(), s.keys.end(), 0);
    for (size_t i=1; i<states; ++i) {
      const uint64_t key=(((uint64_t)s.parent[i]<<3)|s.slot[i])+1, mask=s.keys.size()-1;
      auto j=StateTable::mix(key)&mask;
      while (s.keys[j]) j=(j+1)&mask;
      s.keys[j]=key; s.ids[j]=(int32_t)i;
    }
    s.count=states-1;
    m.bytes=bytes+12.0*((m.hkeys.size()-hashSlots)+(s.keys.size()-stateSlots));
    m.rng.state=dealRng; m.es->actionRng.state=actionRng;
  }
};
