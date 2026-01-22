import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from "typeorm";
import { User } from "./User";
import { Room } from "./Room";

@Entity()
export class Utterance {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => Room, (room) => room.utterances)
  room!: Room;

  @ManyToOne(() => User, (user) => user.utterances)
  user!: User;

  @Column({ type: "text" })
  text!: string;

  @Column({ type: "timestamp", default: () => "CURRENT_TIMESTAMP" })
  timestamp!: Date;
}
