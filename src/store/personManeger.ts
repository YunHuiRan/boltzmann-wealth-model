import { defineStore } from "pinia";
import { config } from "../config";
import { Person } from "./Person";

type PendingTransfer = {
  payerId: string;
  targetId: string;
};

export const usePersonManagerStore = defineStore("personManager", {
  state: () => ({
    persons: [] as Person[],
    pendingTransfers: [] as PendingTransfer[],
  }),

  getters: {
    activePersons: (state) =>
      state.persons.filter((person) => !person.isBroken),
  },

  actions: {
    createPerson(balance = config.initialBalance): Person {
      const person = new Person(balance);
      this.persons.push(person);
      return person;
    },

    createPersons(count = config.personCount, balance = config.initialBalance) {
      this.persons = [];
      this.pendingTransfers = [];
      for (let i = 0; i < count; i++) {
        this.createPerson(balance);
      }
    },

    getPersonById(id: string): Person | undefined {
      return this.persons.find((person) => person.id === id);
    },

    selectTargets() {
      const candidateIds = this.persons.map((person) => person.id);
      this.pendingTransfers = [];

      for (const person of this.persons) {
        const roundIndex = person.startRound();
        const targetId = person.selectTarget(candidateIds, roundIndex);
        if (targetId) {
          this.pendingTransfers.push({ payerId: person.id, targetId });
        }
      }
    },

    transfer() {
      for (const { payerId, targetId } of this.pendingTransfers) {
        const payer = this.getPersonById(payerId);
        const target = this.getPersonById(targetId);
        if (!payer || !target) continue;

        payer.pay();
        target.receive();
      }

      this.pendingTransfers = [];
    },

    runRound() {
      this.selectTargets();
      this.transfer();
    },

    runRounds(count = config.rounds) {
      for (let i = 0; i < count; i++) {
        this.runRound();
      }
      this.settleReceivedFrom();
    },

    settleReceivedFrom() {
      const roundCount = this.persons[0]?.paidTo.length ?? 0;

      for (const person of this.persons) {
        person.initReceivedFrom(roundCount);
      }

      for (let roundIndex = 0; roundIndex < roundCount; roundIndex++) {
        for (const payer of this.persons) {
          const targetId = payer.paidTo[roundIndex];
          if (!targetId) continue;
          this.getPersonById(targetId)?.recordIncoming(payer.id, roundIndex);
        }
      }
    },
  },
});
