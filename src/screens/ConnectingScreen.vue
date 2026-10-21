<script setup lang="ts">
// Shimmer skeleton of Home while the wallet connects.
</script>

<template>
  <div class="kb-scroll">
    <div class="page" aria-busy="true">
      <div class="head">
        <div class="row"><div class="kb-skel" style="width: 34px; height: 34px; border-radius: 7.5px" /><div class="kb-skel" style="width: 92px; height: 16px; border-radius: 999px" /></div>
        <div class="kb-skel" style="width: 112px; height: 36px; border-radius: 999px" />
      </div>
      <div class="col">
        <div class="kb-skel" style="width: 78%; height: 34px; border-radius: 10px" />
        <div class="kb-skel" style="width: 92%; height: 34px; border-radius: 10px" />
        <div class="kb-skel" style="width: 58%; height: 34px; border-radius: 10px" />
      </div>
      <div class="kb-skel" style="width: 100%; height: 10px; border-radius: 999px" />
      <div class="col">
        <div class="kb-skel" style="width: 32%; height: 12px; border-radius: 999px" />
        <div class="kb-skel" style="width: 64%; height: 58px; border-radius: 14px" />
      </div>
      <div class="kb-skel" style="width: 100%; height: 220px; border-radius: 28px" />
      <div class="grid">
        <div class="kb-skel" style="height: 104px; border-radius: 24px" />
        <div class="kb-skel" style="height: 104px; border-radius: 24px" />
      </div>
      <div class="pill-wrap">
        <div class="pill"><div class="kb-spinner" data-kb-keep="1" />Connecting to network</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { position: relative; min-height: 100%; padding: 8px 20px 28px; display: flex; flex-direction: column; gap: 20px; }
.head { display: flex; align-items: center; justify-content: space-between; height: 52px; }
.row { display: flex; align-items: center; gap: 10px; }
.col { display: flex; flex-direction: column; gap: 10px; }
.grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
.pill-wrap { position: absolute; left: 0; right: 0; bottom: calc(120px + var(--kb-safe-bottom)); display: flex; justify-content: center; }
.pill {
  height: 44px; padding: 0 18px; border-radius: 999px; background: var(--kb-raised); border: 1px solid var(--kb-line);
  display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 700; box-shadow: var(--kb-sh-float);
}
</style>
