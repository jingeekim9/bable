/* eslint-disable */
const { conversation, Card, Image, Media } = require('@assistant/conversation');
const functions = require('firebase-functions');
const admin = require('firebase-admin');

const app = conversation({
    clientId: '208901405788-c60vt8eb6ucjmn2n3hataf5h8utsfvkb.apps.googleusercontent.com'
});

admin.initializeApp();
// To access Cloud Firestore
const db = admin.firestore();
const auth = admin.auth();

// Invoked on successful completion of account linking flow, check if we need to
// create a Firebase user.
app.handle('linkAccount', async (conv) => {
    const payload = conv.user.params.tokenPayload;
    if (payload) {
        // Get UID for Firebase auth user using the email of the user
        const email = payload.email;
        if (email) {
            try {
                await auth.getUserByEmail(email).then((userRecord) => {
                    conv.user.params.email = userRecord.email;
                });
            } catch (e) {
                if (e.code !== 'auth/user-not-found') {
                    throw e;
                }
                // If the user is not found, create a new Firebase auth user
                // using the email obtained from Google Assistant
                await auth.createUser({ email: email }).then((userRecord) => {
                    conv.user.params.email = userRecord.email;
                });

            }
        }
    }
});

app.handle('read_handle', conv => {
    const email = conv.user.params.email;
    conv.add(email);
})

app.handle('get_url', conv => {
    const bookTitle = conv.intent.params.book.resolved;
    conv.session.params.koreanTitle = conv.intent.params.book.original;
    conv.session.params.bookTitle = bookTitle;
    const book = db.doc('books/' + bookTitle);
    const snapshot = book;
    if (snapshot.empty) {
        conv.session.params.url = "책이 없습니다."
        return;
    }

    return snapshot.get().then(snapshot => {
        let data = snapshot.data();
        conv.session.params.url = data.link;
        conv.session.params.read = data.read;
    });
})

app.handle('read_url', async (conv) => {
    const url = conv.session.params.url;
    const bookTitle = conv.session.params.bookTitle;
    const readAmount = conv.session.params.read + 1;
    const book = db.doc('books/' + bookTitle);
    const email = conv.user.params.email;

    let documentRef = await db.collection('users').doc(email).collection('books').doc(bookTitle).set({
        'Date Read': admin.firestore.Timestamp.fromDate(new Date()),
        'Finished': false,
        'BookTitle': conv.session.params.koreanTitle,
        'StoppedTime': ""
    });

    const snapshot = book;
    if (snapshot.empty) {
        conv.session.params.url = "No books"
        return;
    }

    if (url) {
        snapshot.update({ read: readAmount });
        conv.add("책 읽기가 시작합니다.");
        conv.add(new Media({
            mediaObjects: [
                {
                    name: bookTitle,
                    url: url,
                }
            ],
            mediaType: 'AUDIO',
            optionalMediaControls: ['PAUSED', 'STOPPED']
        }));
    }
    else {
        conv.add("URL이 없습니다.")
    }
})

app.handle('continue_read', async (conv) => {
    const locale = conv.user.locale;
    const email = conv.user.params.email;
    const collections = db.collection('users').doc(email).collection('books').where("Finished", "==", false).orderBy('Date Read', 'desc').limit(5);
    const snapshot = collections;
    if (snapshot.empty) {
        conv.add("읽고 있는 책이 없습니다.");
        return;
    }


    bookTitleArray = [];
    const newSnapshot = await snapshot.get();
    newSnapshot.forEach(doc => {
        let data = doc.data();
        bookTitleArray.push(data['BookTitle']);
    })

    if(bookTitleArray.length == 1)
    {
        if (locale == "ko-KR") 
        {
            conv.add("책을 하나 만 읽고 계시네요. " + bookTitleArray.toString() + "을 계속 읽고 싶으시다면 책 이름을 말씀해주세요.")
        }
        else
        {
            conv.add("You are currently read one book. Would you like to continue reading " + bookTitleArray.toString() + "?")
        }
    }
    else if(bookTitleArray.length > 0)
    {
        if (locale == "ko-KR") {
            conv.add(bookTitleArray.toString() + "중 하나 골라주세요.")
        }
        else {
            conv.add("The available genres are " + bookTitleArray.toString() + ". Please choose one.")
        }
    }
    else
    {
        if (locale == "ko-KR") {
            conv.add("읽고 있는 책이 없습니다.")
        }
        else {
            conv.add("There are no books you are currently reading.")
        }
    }
})

app.handle('continue_read_url', async (conv) => {
    const bookTitle = conv.intent.params.book.resolved;
    const email = conv.user.params.email;
    const userBook = db.collection('users').doc(email).collection('books').doc(bookTitle);
    if (userBook.empty) {
        conv.add('책을 못 찾았습니다.')
        return;
    }

    const userBookSnapshot = await userBook.get()
    let userBookData = userBookSnapshot.data();
    progressTime = userBookData.StoppedTime;

    conv.session.params.bookTitle = bookTitle;

    const book = db.doc('books/' + bookTitle);
    if (book.empty) {
        conv.add('책을 못 찾았습니다.')
        return;
    }

    const bookSnapshot = await book.get()
    let bookData = bookSnapshot.data();
    bookUrl = bookData.link;


    await db.collection('users').doc(email).collection('books').doc(bookTitle).update({
        'Date Read': admin.firestore.Timestamp.fromDate(new Date())
    });

    if (bookUrl) {
        conv.add("책 읽기가 시작합니다.");
        conv.add(new Media({
            mediaObjects: [
                {
                    name: bookTitle,
                    url: bookUrl,
                }
            ],
            mediaType: 'AUDIO',
            optionalMediaControls: ['PAUSED', 'STOPPED'],
            start_offset: progressTime
        }));
    }
    else {
        conv.add("URL이 없습니다.")
    }
})


// Media status
app.handle('media_status', async (conv) => {
    const mediaStatus = conv.intent.params.MEDIA_STATUS.resolved;
    switch (mediaStatus) {
        case 'FINISHED':
            conv.add('Media has finished playing.');
            const email = conv.user.params.email;
            const bookTitle = conv.session.params.bookTitle;

            let documentRef = await db.collection('users').doc(email).collection('books').doc(bookTitle).update({
                'Finished': true,
                'StoppedTime': ""
            });

            break;
        case 'FAILED':
            conv.add('Media has failed.');
            break;
        case 'PAUSED' || 'STOPPED':
            if (conv.request.context) {
                // Persist the media progress value
                const progress = conv.request.context.media.progress;
                const email = conv.user.params.email;
                const bookTitle = conv.session.params.bookTitle;

                let documentRef = await db.collection('users').doc(email).collection('books').doc(bookTitle).update({
                    'Finished': false,
                    'StoppedTime': progress
                });

            }
            // Acknowledge pause/stop
            conv.add(new Media({
                mediaType: 'MEDIA_STATUS_ACK'
            }));
            break;
        default:
            conv.add('Unknown media status received.');
    }
});

app.handle('read_all', async(conv) => {
    const locale = conv.user.locale;
    const collections = db.collection('books');
    const snapshot = collections;
    if (snapshot.empty) {
        conv.session.params.genre = "Error"
        return;
    }
    bookNames = [];

    const bookSnapshot = await snapshot.get();
    bookSnapshot.forEach(doc => {
        let data = doc.data();
        if (locale == "ko-KR") {
            bookNames.push(data['name-kr']);
        }
        else {
            bookNames.push(data['name-en']);
        }
    });

    if (locale == "ko-KR") {
        conv.add(bookNames.toString() + "중 하나 골라주세요.")
    }
    else {
        conv.add("The available books are " + bookNames.toString() + ". Please choose one.")
    }

})

// Getting Genres Start
app.handle('get_all_genres', conv => {
    const locale = conv.user.locale;
    const collections = db.collection('books');
    const snapshot = collections;
    genres = [];
    if (snapshot.empty) {
        conv.session.params.genre = "에러가 발생했습니다. 처음으로 돌아가고 싶다고 말해주세요."
        return;
    }

    return snapshot.get().then(snapshot => {
        snapshot.forEach(doc => {
            let data = doc.data();
            if (locale == "ko-KR") {
                if (doc.data()['genre-kr']) {
                    genres.push(data['genre-kr'])
                }
            }
            else {
                if (doc.data()['genre-en']) {
                    genres.push(data['genre-en'])
                }
            }
        })
        conv.session.params.genre = genres;
    });
})

app.handle('read_genre', conv => {
    const locale = conv.user.locale;
    const genres = conv.session.params.genre;

    uniqueGenres = [...new Set(genres)]
    if (locale == "ko-KR") {
        conv.add(uniqueGenres.toString() + "중 하나 골라주세요.")
    }
    else {
        conv.add("The available genres are " + uniqueGenres.toString() + ". Please choose one.")
    }

})

app.handle('list_genre_books', async (conv) => {
    const locale = conv.user.locale;
    const genre = conv.intent.params.genre.resolved;
    // We'll get the books the person has read and put it into an array.
    // Then we're going to exlude all the books in this array, in the next query that we're going to call.
    const email = conv.user.params.email;
    const alreadyReadCollection = db.collection('users').doc(email).collection('books').where("Finished", "==", true).orderBy('Date Read');
    const reReadSnapshot = alreadyReadCollection;

    reReadBooks = ["NULL"]; // Making empty array
    const newSnapshot = await reReadSnapshot.get();
    newSnapshot.forEach(doc => {
        reReadBooks.push(doc.id); // Adding to array one by one
    })


    const collections = db.collection('books').where("name-en", "not-in", reReadBooks).where("genre-en", "==", genre);
    const snapshot = collections;
    genreBooks = [];
    if (snapshot.empty) {
        conv.session.params.genreBooks = "Error"
        return;
    }

    return snapshot.get().then(snapshot => {
        snapshot.forEach(doc => {
            let data = doc.data();
            if (locale == "ko-KR") {
                if (doc.data()['name-kr']) {
                    genreBooks.push(data['name-kr'])
                }
            }
            else {
                if (doc.data()['name-en']) {
                    genreBooks.push(data['name-en'])
                }
            }
        })
        conv.session.params.genreBooks = genreBooks;
    });
})

app.handle('read_genre_books', conv => {
    const locale = conv.user.locale;
    const genreBooks = conv.session.params.genreBooks;

    if (locale == "ko-KR") {
        conv.add(genreBooks.toString() + "중 하나 골라주세요.")
    }
    else {
        conv.add("The available books are " + genreBooks.toString() + ". Please choose one.")
    }
})
// Getting Genres End

// Getting Newest Uploads Start
app.handle('get_newest_uploads', async(conv) => {
    const locale = conv.user.locale;
    const email = conv.user.params.email;
    const alreadyReadCollection = db.collection('users').doc(email).collection('books').where("Finished", "==", true).orderBy('Date Read');
    const reReadSnapshot = alreadyReadCollection;

    reReadBooks = ["NULL"]; // Making empty array
    const newSnapshot = await reReadSnapshot.get();
    newSnapshot.forEach(doc => {
        reReadBooks.push(doc.id); // Adding to array one by one
    })

    const collections = db.collection('books').where("name-en", "not-in", reReadBooks).orderBy("name-en").orderBy('upload_date').limit(5);
    const snapshot = collections;
    newestUploads = [];
    if (snapshot.empty) {
        conv.session.params.newestUploads = "에러가 발생했습니다. 처음으로 돌아가고 싶다고 말해주세요."
        return;
    }

    return snapshot.get().then(snapshot => {
        snapshot.forEach(doc => {
            let data = doc.data();
            if (locale == "ko-KR") {
                if (doc.data()['name-kr']) {
                    newestUploads.push(data['name-kr'])
                }
            }
            else {
                if (doc.data()['name-en']) {
                    newestUploads.push(data['name-en'])
                }
            }
        })
        conv.session.params.newestUploads = newestUploads;
    });
});

app.handle('read_newest_uploads', conv => {
    const locale = conv.user.locale;
    const newestUploads = conv.session.params.newestUploads;

    if (locale == "ko-KR") {
        conv.add(newestUploads.toString() + "중 하나 골라주세요.")
    }
    else {
        conv.add("The available books are " + newestUploads.toString() + ". Please choose one.")
    }
});
// Getting Newest Uploads End

// Getting Popular Books Start
app.handle('get_popular_books', async(conv) => {
    const locale = conv.user.locale;
    const email = conv.user.params.email;
    const alreadyReadCollection = db.collection('users').doc(email).collection('books').where("Finished", "==", true).orderBy('Date Read');
    const reReadSnapshot = alreadyReadCollection;

    reReadBooks = ["NULL"]; // Making empty array
    const newSnapshot = await reReadSnapshot.get();
    newSnapshot.forEach(doc => {
        reReadBooks.push(doc.id); // Adding to array one by one
    })
    const collections = db.collection('books').where("name-en", "not-in", reReadBooks).orderBy("name-en").orderBy('read', 'desc').limit(5);
    const snapshot = collections;
    popularBooks = [];
    if (snapshot.empty) {
        conv.session.params.popularBooks = "에러가 발생했습니다. 처음으로 돌아가고 싶다고 말해주세요."
        return;
    }

    return snapshot.get().then(snapshot => {
        snapshot.forEach(doc => {
            let data = doc.data();
            if (locale == "ko-KR") {
                if (doc.data()['name-kr']) {
                    popularBooks.push(data['name-kr'])
                }
            }
            else {
                if (doc.data()['name-en']) {
                    popularBooks.push(data['name-en'])
                }
            }
        })
        conv.session.params.popularBooks = popularBooks;
    });
});

app.handle('read_popular_books', conv => {
    const locale = conv.user.locale;
    const popularBooks = conv.session.params.popularBooks;

    if (locale == "ko-KR") {
        conv.add(popularBooks.toString() + "중 하나 골라주세요.")
    }
    else {
        conv.add("The available books are " + popularBooks.toString() + ". Please choose one.")
    }
});
// Getting Popular Books End

//Reading out already read books
app.handle('reread_handle', async (conv) => {
    const email = conv.user.params.email;
    const locale = conv.user.locale;
    const collections = db.collection('users').doc(email).collection('books').where("Finished", "==", true).orderBy('Date Read').limit(5);
    const snapshot = collections;
    if (snapshot.empty) {
        conv.add("읽었던 책이 없습니다.");
        return;
    }

    reReadBooks = []; // Making empty array
    const newSnapshot = await snapshot.get();
    newSnapshot.forEach(doc => {
        reReadBooks.push(doc.id); // Adding to array one by one
    })

    const books = db.collection('books').where('name-en', 'in', reReadBooks);
    bookNames = [];
    if (books.empty) {
        conv.add('문제가 생겼습니다.');
        return;
    }

    const bookSnapshot = await books.get();
    bookSnapshot.forEach(doc => {
        let data = doc.data();
        if (locale == "ko-KR") {
            bookNames.push(data['name-kr']);
        }
        else {
            bookNames.push(data['name-en']);
        }
    });

    if (locale == "ko-KR") {
        if(bookNames.length == 1)
        {
            conv.add("책을 하나 만 끝까지 읽으셨네요. " + bookNames.toString() + "을 다시 읽고싶으면 책이름을 말해주세요.")
        }
        else
        {
            conv.add(bookNames.toString() + " 중 하나 골라주세요.")
        }
    }
    else {
        if(bookNames.length == 1)
        {
            conv.add("You have only read one book. Would you like to read " + bookNames.toString() + " again?")
        }
        else
        {
            conv.add("The available books are " + bookNames.toString() + ". Please choose one.")
        }
    }


});

app.handle('answer_to_question_one', async(conv) => {
    const answer = conv.session.params.Answer;
    const email = conv.user.params.email;
    const bookTitle = conv.session.params.bookTitle;
    let documentRef = await db.collection('review').add({
        'dateAdded': admin.firestore.Timestamp.fromDate(new Date()),
        'email': email,
        'bookTitle': bookTitle,
        'q1': answer
    });
    
    conv.session.params.curReviewId = documentRef.id;
});

app.handle('answer_to_question_two', async(conv) => {
    const answer = conv.session.params.Answer;
    const reviewId = conv.session.params.curReviewId;
    let documentRef = await db.collection('review').doc(reviewId).set({
        'q2': answer
    }, { merge: true })
})

app.handle('answer_to_question_three', async(conv) => {
    const answer = conv.session.params.Answer;
    const reviewId = conv.session.params.curReviewId;
    let documentRef = await db.collection('review').doc(reviewId).set({
        'q3': answer
    }, { merge: true })
})

app.handle('answer_to_question_four', async(conv) => {
    const answer = conv.session.params.Answer;
    const reviewId = conv.session.params.curReviewId;
    let documentRef = await db.collection('review').doc(reviewId).set({
        'q4': answer
    }, { merge: true })
})

app.handle('answer_to_question_five', async(conv) => {
    const answer = conv.session.params.Answer;
    const reviewId = conv.session.params.curReviewId;
    let documentRef = await db.collection('review').doc(reviewId).set({
        'q5': answer
    }, { merge: true })
})

exports.ActionsOnGoogleFulfillment = functions.https.onRequest(app);
