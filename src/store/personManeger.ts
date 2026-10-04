import { defineStore } from "pinia";
import { markRaw } from "vue";
import { config } from "../config";
import type { Person } from "./Person";
import { WealthSimulation } from "./WealthSimulation";
import type { Receivers, RoundTransfer } from "./WealthSimulation";

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export const usePersonManagerStore = defineStore("personManager", {
  state: () => ({
    simulation: markRaw(new WealthSimulation()),
    version: 0,
    running: false,
    tickHandle: 0,
    tickKind: "none" as "none" | "raf" | "timeout",
  }),

  getters: {
    totalRounds: () => config.rounds,

    personCount: (state) => {
      void state.version;
      return state.simulation.count;
    },

    round: (state) => {
      void state.version;
      return state.simulation.round;
    },

    isFinished: (state) => {
      void state.version;
      return state.simulation.round >= config.rounds;
    },

    progress: (state) => {
      void state.version;
      return config.rounds > 0
        ? Math.min(1, state.simulation.round / config.rounds)
        : 1;
    },

    activeCount: (state) => {
      void state.version;
      let active = 0;
      const persons = state.simulation.persons;
      for (let i = 0; i < persons.length; i++) {
        if (!persons[i].isBroken) active++;
      }
      return active;
    },

    histogram: (state) => {
      void state.version;
      return state.simulation.currentHistogram();
    },

    statsSeries: (state) => {
      void state.version;
      return state.simulation.statSamples();
    },

    receivers: (state) => {
      void state.version;
      return state.simulation.buildReceivers();
    },

    personAt: (state) => (index: number) => {
      void state.version;
      const person = state.simulation.persons[index];
      if (!person) return null;
      return {
        id: person.id,
        balance: person.balance,
        isBroken: person.isBroken,
        totalIncome: person.totalIncome,
        totalExpenses: person.totalExpenses,
        paidRounds: person.paidRounds,
        paidTo: person.paidTo,
      };
    },
  },

  actions: {
    createPersons(count = config.personCount, balance = config.initialBalance) {
      this.stop();
      this.simulation.reset(count, balance);
      this.version++;
    },

    getPerson(index: number): Person | undefined {
      return this.simulation.persons[index];
    },

    runRound() {
      this.simulation.runRound();
      this.version++;
    },

    runRounds(count = config.rounds) {
      this.simulation.runRounds(count);
      this.version++;
    },

    runChunk() {
      const simulation = this.simulation;
      const remaining = config.rounds - simulation.round;
      if (remaining <= 0) {
        this.stop();
        return;
      }

      const startedAt = now();
      let done = 0;
      while (done < remaining) {
        const batch = Math.min(config.tickCheckRounds, remaining - done);
        simulation.runRounds(batch);
        done += batch;
        if (now() - startedAt >= config.tickBudgetMs) break;
      }

      this.version++;
      if (simulation.round >= config.rounds) this.stop();
    },

    start() {
      if (this.running) return;
      if (this.simulation.round >= config.rounds) return;
      this.running = true;
      this.scheduleTick();
    },

    scheduleTick() {
      if (!this.running) return;

      const step = () => {
        if (!this.running) return;
        this.runChunk();
        if (this.running) this.scheduleTick();
      };

      if (typeof requestAnimationFrame === "function") {
        this.tickHandle = requestAnimationFrame(step);
        this.tickKind = "raf";
      } else {
        this.tickHandle = setTimeout(step, 0);
        this.tickKind = "timeout";
      }
    },

    stop() {
      this.running = false;
      if (this.tickKind === "raf") cancelAnimationFrame(this.tickHandle);
      else if (this.tickKind === "timeout") clearTimeout(this.tickHandle);
      this.tickKind = "none";
      this.tickHandle = 0;
    },

    runToEnd() {
      this.stop();
      const remaining = config.rounds - this.simulation.round;
      if (remaining > 0) this.simulation.runRounds(remaining);
      this.version++;
    },

    transfersOfRound(round?: number): RoundTransfer[] {
      return this.simulation.transfersOfRound(
        round ?? this.simulation.round - 1,
      );
    },

    paidToOf(index: number, round?: number): number {
      return this.simulation.paidToOf(
        index,
        round ?? this.simulation.round - 1,
      );
    },

    payersOf(index: number, round?: number): number[] {
      const { offsets, payers } = this.simulation.buildReceivers(
        round ?? this.simulation.round - 1,
      );
      if (index < 0 || index + 1 >= offsets.length) return [];
      return Array.from(payers.subarray(offsets[index], offsets[index + 1]));
    },

    receiversOfRound(round?: number): Receivers {
      return this.simulation.buildReceivers(round ?? this.simulation.round - 1);
    },

    sampleHistogram(index: number): Uint32Array {
      return this.simulation.sampleHistogram(index);
    },

    giniOfSample(index: number): number {
      return this.simulation.giniOfSample(index);
    },

    estimatedHistoryBytes(): number {
      return this.simulation.estimatedHistoryBytes();
    },
  },
});
