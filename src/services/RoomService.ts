import { AppDataSource } from "../data-source";
import { Room } from "../entity/Room";
import { User } from "../entity/User";

export class RoomService {
  private roomRepository = AppDataSource.getRepository(Room);
  private userRepository = AppDataSource.getRepository(User);

  async createRoom(): Promise<Room> {
    const owner = new User();
    owner.name = "Owner"; // For now, we'll just create a dummy owner
    await this.userRepository.save(owner);

    const room = new Room();
    room.owner = owner;
    return this.roomRepository.save(room);
  }

  async joinRoom(roomId: string, userName: string): Promise<User | null> {
    const room = await this.roomRepository.findOne({ 
      where: { id: roomId },
      relations: ["participants"] 
    });
    if (!room) {
      return null;
    }

    const user = new User();
    user.name = userName;
    await this.userRepository.save(user);

    if (!room.participants) {
      room.participants = [];
    }
    room.participants.push(user);
    await this.roomRepository.save(room);

    return user;
  }

  async getLog(roomId: string): Promise<Room | null> {
    return this.roomRepository.findOne({
      where: { id: roomId },
      relations: ["utterances", "utterances.user", "participants"],
    });
  }
}
