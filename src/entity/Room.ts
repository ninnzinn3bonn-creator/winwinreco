import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, ManyToMany, JoinTable } from "typeorm";
import { User } from "./User";
import { Utterance } from "./Utterance";

@Entity()
export class Room {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "timestamp", default: () => "CURRENT_TIMESTAMP" })
  createdAt!: Date;

  @ManyToOne(() => User, (user) => user.ownedRooms)
  owner!: User;

  @OneToMany(() => Utterance, (utterance) => utterance.room)
  utterances!: Utterance[];

  @ManyToMany(() => User, (user) => user.joinedRooms)
  @JoinTable()
  participants!: User[];
}
