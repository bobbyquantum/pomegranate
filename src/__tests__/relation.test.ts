import { Database } from '../database/Database';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import { Model } from '../model/Model';
import { m } from '../schema/builder';

const UserSchema = m.model('users', {
  name: m.text(),
});

const PostSchema = m.model('posts', {
  title: m.text(),
  author: m.belongsTo(() => UserSchema, { key: 'author_id' }),
  comments: m.hasMany(() => CommentSchema, { foreignKey: 'post_id' }),
});

const CommentSchema = m.model('comments', {
  body: m.text(),
  post: m.belongsTo(() => PostSchema, { key: 'post_id' }),
});

class User extends Model<typeof UserSchema> {
  static schema = UserSchema;
}

class Post extends Model<typeof PostSchema> {
  static schema = PostSchema;

  get authorRelation() {
    return this.belongsTo('author');
  }

  get commentsRelation() {
    return this.hasMany('comments');
  }
}

class Comment extends Model<typeof CommentSchema> {
  static schema = CommentSchema;
}

async function setup() {
  const db = new Database({
    adapter: new LokiAdapter({ databaseName: 'relation-test' }),
    models: [User, Post, Comment],
  });
  await db.initialize();
  return db;
}

function waitForAsyncEmission() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('Model relations', () => {
  let db: Database;

  beforeEach(async () => {
    db = await setup();
  });

  afterEach(async () => {
    await db.close();
  });

  it('reads, observes, and updates belongs_to relations', async () => {
    const { author, replacementAuthor, post } = await db.write(async (): Promise<{
      author: User;
      replacementAuthor: User;
      post: Post;
    }> => {
      const createdAuthor = (await db.get(User).create({ name: 'Alice' })) as User;
      const createdReplacementAuthor = (await db.get(User).create({ name: 'Bea' })) as User;
      const createdPost = (await db.get(Post).create({
        title: 'First post',
        author: createdAuthor.id,
      })) as Post;

      return {
        author: createdAuthor,
        replacementAuthor: createdReplacementAuthor,
        post: createdPost,
      };
    });

    expect(post.getField('author')).toBe(author.id);
    expect(post.authorRelation.id).toBe(author.id);
    const initialAuthor = await post.authorRelation.fetch();
    expect(initialAuthor?.id).toBe(author.id);

    const observedAuthors: Array<User | null> = [];
    const unsub = post.authorRelation.observe().subscribe((value) => {
      observedAuthors.push(value as User | null);
    });

    await waitForAsyncEmission();
    expect(observedAuthors.at(-1)?.id).toBe(author.id);

    await db.write(async () => {
      await author.update({ name: 'Alicia' });
    });

    await waitForAsyncEmission();
    expect(observedAuthors.at(-1)?.getField('name')).toBe('Alicia');

    await db.write(async () => {
      await post.update({ author: replacementAuthor.id } as any);
    });

    expect(post.getField('author')).toBe(replacementAuthor.id);
    const replacement = await post.authorRelation.fetch();
    expect(replacement?.id).toBe(replacementAuthor.id);

    unsub();
  });

  it('returns null for missing belongs_to foreign keys', async () => {
    const post = await db.write(async (): Promise<Post> => {
      return (await db.get(Post).create({ title: 'Draft post' })) as Post;
    });

    expect(post.authorRelation.id).toBe('');
    await expect(post.authorRelation.fetch()).resolves.toBeNull();

    const observedAuthors: Array<User | null> = [];
    const unsub = post.authorRelation.observe().subscribe((value) => {
      observedAuthors.push(value as User | null);
    });

    expect(observedAuthors).toEqual([null]);
    unsub();
  });

  it('fetches and observes has_many relations', async () => {
    const post = await db.write(async (): Promise<Post> => {
      return (await db.get(Post).create({ title: 'Observable post' })) as Post;
    });

    const observedComments: Comment[][] = [];
    const unsub = post.commentsRelation.observe().subscribe((value) => {
      observedComments.push(value as Comment[]);
    });

    await waitForAsyncEmission();
    expect(observedComments.at(-1)).toHaveLength(0);

    const comment = await db.write(async (): Promise<Comment> => {
      return (await db.get(Comment).create({ body: 'First!', post: post.id })) as Comment;
    });

    await waitForAsyncEmission();

    const fetchedComments = await post.commentsRelation.fetch();
    expect(fetchedComments).toHaveLength(1);
    expect(fetchedComments[0].id).toBe(comment.id);
    expect(observedComments.at(-1)?.map((item) => item.id)).toContain(comment.id);

    unsub();
  });

  it('throws for invalid relation access and missing collections', async () => {
    const post = await db.write(async (): Promise<Post> => {
      return (await db.get(Post).create({ title: 'Orphaned post' })) as Post;
    });

    expect(() => post.belongsTo('comments' as any)).toThrow('No belongs_to relation');
    expect(() => post.hasMany('author' as any)).toThrow('No has_many relation');

    class Ghost extends Model<typeof GhostSchema> {
      static schema = GhostSchema;
    }

    expect(() => db.get(Ghost)).toThrow('No collection registered for table "ghosts"');
    expect(() => db.collection('ghosts')).toThrow('No collection registered for table "ghosts"');

    await expect((db as any)._findById('ghosts', 'missing')).rejects.toThrow(
      'No collection registered for table "ghosts"',
    );
    expect(() => (db as any)._observeById('ghosts', 'missing')).toThrow(
      'No collection registered for table "ghosts"',
    );
    await expect((db as any)._fetchRelated('ghosts', 'post_id', 'missing')).rejects.toThrow(
      'No collection registered for table "ghosts"',
    );
    expect(() => (db as any)._observeRelated('ghosts', 'post_id', 'missing')).toThrow(
      'No collection registered for table "ghosts"',
    );
  });

  it('rejects models without a static schema', () => {
    class BrokenModel extends Model<any> {
      static schema = undefined as any;
    }

    expect(
      () =>
        new Database({
          adapter: new LokiAdapter({ databaseName: 'broken-relation-test' }),
          models: [BrokenModel],
        }),
    ).toThrow('Model class is missing static schema property');
  });
});

const GhostSchema = m.model('ghosts', {
  name: m.text(),
});
