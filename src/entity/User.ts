import { Entity, PrimaryGeneratedColumn, Column, OneToMany, ManyToMany } from "typeorm";
import { Room } from "./Room";
import { Utterance } from "./Utterance";

@Entity()
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  name!: string;

  @OneToMany(() => Room, (room) => room.owner)
  ownedRooms!: Room[];

  @OneToMany(() => Utterance, (utterance) => utterance.user)
  utterances!: Utterance[];

  @ManyToMany(() => Room, (room) => room.participants)
  joinedRooms!: Room[];
}
