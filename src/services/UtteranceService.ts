import { AppDataSource } from "../data-source";
import { Utterance } from "../entity/Utterance";
import { Room } from "../entity/Room";
import { User } from "../entity/User";

export class UtteranceService {
  private utteranceRepository = AppDataSource.getRepository(Utterance);

  async createUtterance(
    roomId: string,
    userId: string,
    text: string
  ): Promise<Utterance | null> {
    const room = await AppDataSource.getRepository(Room).findOne({
      where: { id: roomId },
    });
    const user = await AppDataSource.getRepository(User).findOne({
      where: { id: userId },
    });

    if (!room || !user) {
      return null;
    }

    const utterance = new Utterance();
    utterance.room = room;
    utterance.user = user;
    utterance.text = text;

    return this.utteranceRepository.save(utterance);
  }
}
