import os
import pandas as pd
# from sklearn.tree import DecisionTreeClassifier, plot_tree
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import confusion_matrix, classification_report
import shap
import matplotlib.pyplot as plt
from sklearn.tree import export_text
from sklearn.inspection import permutation_importance
import wittgenstein as lw
from sklearn.metrics import accuracy_score
from imblearn.under_sampling import RandomUnderSampler
import json
from sklearn.model_selection import cross_val_score
from sklearn.linear_model import LogisticRegression
from sklearn.svm import SVC
from sklearn.neighbors import KNeighborsClassifier
from sklearn.tree import DecisionTreeClassifier, export_text
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.ensemble import AdaBoostClassifier
from sklearn.model_selection import GridSearchCV, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.base import BaseEstimator, TransformerMixin
from rulefit import RuleFit


# Custom transformer for Fisher score based feature selection
class FisherScoreSelector(BaseEstimator, TransformerMixin):
    def __init__(self, k=10):
        self.k = k  # number of top features to select

    def fit(self, X, y):
        # Assume X is a pandas DataFrame and y is a pandas Series
        features = X.columns
        classes = y.unique()
        overall_mean = X.mean()
        scores = pd.Series(index=features, dtype=float)

        for feature in features:
            numerator = 0.0
            denominator = 0.0
            for c in classes:
                X_c = X.loc[y == c, feature]
                n_c = len(X_c)
                mean_c = X_c.mean()
                var_c = X_c.var(ddof=0)  # population variance; use ddof=1 for sample variance
                numerator += n_c * ((mean_c - overall_mean[feature]) ** 2)
                denominator += n_c * var_c
            scores[feature] = numerator / denominator if denominator != 0 else 0.0

        # Store the scores and the selected features
        self.scores_ = scores
        self.selected_features_ = scores.sort_values(ascending=False).head(self.k).index.tolist()
        return self

    def transform(self, X):
        # Return only the selected features
        return X[self.selected_features_]

# Combine positive and negative samples
def prepare_data(pivot_df_P, pivot_df_M):
    """
    Prepares the dataset by combining positive and negative samples, assigning labels, and splitting into features and target.

    Parameters:
        pivot_df_P (pd.DataFrame): Positive samples DataFrame.
        pivot_df_M (pd.DataFrame): Negative samples DataFrame.

    Returns:
        X (pd.DataFrame): Feature matrix.
        y (pd.Series): Target labels.
    """
    pivot_df_P = pivot_df_P.copy()
    pivot_df_M = pivot_df_M.copy()

    pivot_df_P['label'] = 1  # Label positive samples as 0
    pivot_df_M['label'] = 0  # Label negative samples as 1

    combined_df = pd.concat([pivot_df_P, pivot_df_M], ignore_index=True)

    # Separate features and target
    X = combined_df.drop(columns=['label','MODEL'])
    X = X.set_index('index')
    y = combined_df[['index','label']]
    y = y.set_index('index')
    y = y.squeeze()

    # Encode only "satisfied" and "violated" values in each column
    def encode_satisfied_violated(df):
        """
        Efficiently encodes columns containing "satisfied", "violated", and "vacsatisfied"
        into two binary columns for "satisfied" and "violated".
        """
        encoded_columns = []  # Store encoded columns to concatenate later
        mapping = {"satisfied": 1, "violated": -1,"v_satisfied":0}

        for column in df.columns:
            # encoded_columns.append((df[column] == "satisfied").astype(int) * 2 - 1)
            encoded_columns.append(df[column].map(mapping))
            # encoded_columns.append((df[column] == "satisfied").astype(int).rename(column + "_satisfied"))
            # encoded_columns.append((df[column] == "violated").astype(int).rename(column + "_violated"))
        # Concatenate all columns at once
        return pd.concat(encoded_columns, axis=1)

    # X = encode_satisfied_violated(X)

    # Convert non-numeric columns to numeric using one-hot encoding
    X = pd.get_dummies(X, drop_first=False)
    # X = X.drop(columns=[col for col in X.columns if col.endswith("v_satisfied")])
    print(X.shape)

    return X, y

# Train random forest, evaluate, and explain with SHAP values
def train_and_evaluate_with_shap(pivot_df_P, pivot_df_M,path,conf):
    """
    Trains a Random Forest classifier, evaluates it, and uses SHAP to visualize feature importance.

    Parameters:
        pivot_df_P (pd.DataFrame): Positive samples DataFrame.
        pivot_df_M (pd.DataFrame): Negative samples DataFrame.
    """
    X, y = prepare_data(pivot_df_P, pivot_df_M)


    # Split into training and test sets
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.3, random_state=333, stratify=y)
    undersampler = RandomUnderSampler(random_state=333)
    X_train, y_train = undersampler.fit_resample(X_train, y_train)

    pipeline = Pipeline([
        ('fisher', FisherScoreSelector()),  # our custom transformer
        ('clf', RandomForestClassifier(n_estimators=100))  # or any classifier you prefer
        # ('clf', DecisionTreeClassifier(max_depth=4, random_state=42))  # or any classifier you prefer
    ])

    # Define a grid of k values (number of features to select)
    param_grid = {
        'fisher__k': [a for a in range(50,X_train.shape[1],50)]  # try different numbers of features
        # 'fisher__k': [250]  # try different numbers of features
    }

    # Set up GridSearchCV to find the best k using cross-validation on the training set
    grid_search = GridSearchCV(pipeline, param_grid, cv=5, scoring='accuracy')
    grid_search.fit(X_train, y_train)

    # Best parameter found and corresponding score
    print("Best k:", grid_search.best_params_['fisher__k'])
    print("Best cross-validation accuracy:", grid_search.best_score_)

    cv_results = pd.DataFrame(grid_search.cv_results_)
    print(cv_results[['params', 'mean_test_score']])

    tolerance = 0.005
    # tolerance = 0.0
    best_score = grid_search.best_score_
    acceptable_models = cv_results[cv_results['mean_test_score'] >= best_score - tolerance]
    # Choose the smallest k among the acceptable models for simplicity
    best_simple_k = acceptable_models['param_fisher__k'].min()

    print("Automatically selected simpler k:", best_simple_k)
    pipeline.set_params(fisher__k=best_simple_k)
    pipeline.fit(X_train, y_train)

    # Now pipeline is the final model with best_simple_k. You can evaluate it:
    y_pred = pipeline.predict(X_test)


    test_accuracy = accuracy_score(y_test, y_pred)
    print("Test set accuracy:", test_accuracy)


    # Evaluate using confusion matrix and classification report
    cm = confusion_matrix(y_test, y_pred)
    report_dict = classification_report(y_test, y_pred, output_dict=True)

    print("Confusion Matrix:")
    print(cm)
    print("\nClassification Report:")
    print(report_dict)

    report_dict['fisher']={x:str(grid_search.cv_results_[x]) for x in grid_search.cv_results_}
    with open(os.path.join(path, f"classification_report_{round(conf*100)}.json"), "w") as f:
        json.dump(report_dict, f, indent=4)

    # get the pipeline's transformer
    fisher_selector = pipeline.named_steps['fisher']
    X_train_selected = fisher_selector.transform(X_train)

    # fit the SHAP explainer on the pipeline's classifier
    explainer = shap.TreeExplainer(pipeline['clf'])
    shap_values = explainer.shap_values(X_train_selected)

    # tree_text = export_text(pipeline['clf'], feature_names=X_train_selected.columns)
    # print(tree_text)


    # # Explain the model with SHAP values
    # explainer = shap.TreeExplainer(pipeline['clf'])
    # shap_values = explainer.shap_values(X_train)

    # selected_features = fisher_selector.get_support(indices=True)
    selected_features = fisher_selector.selected_features_
    # or if your FisherScoreSelector supports returning the actual names:
    # selected_feature_names = X_train.columns[selected_features]
    # shap_df = pd.DataFrame(shap_values[..., 0],
    #                        columns=selected_feature_names)  # for class 0

    # shap_class0 = shap_values[..., 0]
    # shap_df = pd.DataFrame(shap_class0, columns=X_train.columns)
    # shap_df["Feature Values"] = X_train.values.tolist()


    return shap_values, X_train_selected, X_test, explainer,selected_features



def train_and_evaluate_DT(pivot_df_P, pivot_df_M,path,conf):
    """
    Trains a Random Forest classifier, evaluates it, and uses SHAP to visualize feature importance.

    Parameters:
        pivot_df_P (pd.DataFrame): Positive samples DataFrame.
        pivot_df_M (pd.DataFrame): Negative samples DataFrame.
    """
    X, y = prepare_data(pivot_df_P, pivot_df_M)


    # Split into training and test sets
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.3, random_state=333, stratify=y)
    undersampler = RandomUnderSampler(random_state=333)
    X_train, y_train = undersampler.fit_resample(X_train, y_train)

    pipeline = Pipeline([
        ('fisher', FisherScoreSelector()),  # our custom transformer
        ('clf', RandomForestClassifier(n_estimators=100))  # or any classifier you prefer
        # ('clf', DecisionTreeClassifier(max_depth=3,min_samples_leaf=100, random_state=42))  # or any classifier you prefer
    ])

    # Define a grid of k values (number of features to select)
    param_grid = {
        'fisher__k': [a for a in range(50,X_train.shape[1],50)]  # try different numbers of features
        # 'fisher__k': [250]  # try different numbers of features
    }

    # Set up GridSearchCV to find the best k using cross-validation on the training set
    grid_search = GridSearchCV(pipeline, param_grid, cv=5, scoring='accuracy')
    grid_search.fit(X_train, y_train)

    # Best parameter found and corresponding score
    print("Best k:", grid_search.best_params_['fisher__k'])
    print("Best cross-validation accuracy:", grid_search.best_score_)

    cv_results = pd.DataFrame(grid_search.cv_results_)
    print(cv_results[['params', 'mean_test_score']])

    tolerance = 0.005
    # tolerance = 0.0
    best_score = grid_search.best_score_
    acceptable_models = cv_results[cv_results['mean_test_score'] >= best_score - tolerance]
    # Choose the smallest k among the acceptable models for simplicity
    best_simple_k = acceptable_models['param_fisher__k'].min()

    print("Automatically selected simpler k:", best_simple_k)
    pipeline.set_params(fisher__k=best_simple_k)
    pipeline.fit(X_train, y_train)

    # Now pipeline is the final model with best_simple_k. You can evaluate it:
    y_pred = pipeline.predict(X_test)


    test_accuracy = accuracy_score(y_test, y_pred)
    print("Test set accuracy:", test_accuracy)


    # Evaluate using confusion matrix and classification report
    cm = confusion_matrix(y_test, y_pred)
    report_dict = classification_report(y_test, y_pred, output_dict=True)

    print("Confusion Matrix:")
    print(cm)
    print("\nClassification Report:")
    print(report_dict)

    report_dict['fisher']={x:str(grid_search.cv_results_[x]) for x in grid_search.cv_results_}
    with open(os.path.join(path, f"classification_report_{round(conf*100)}.json"), "w") as f:
        json.dump(report_dict, f, indent=4)

    # get the pipeline's transformer
    fisher_selector = pipeline.named_steps['fisher']
    X_train_selected = fisher_selector.transform(X_train)

    rf_model = RuleFit(tree_size=4, sample_fract='default', max_rules=100, random_state=42,rfmode='classify',model_type='r')

    # Fit the RuleFit model on the training data.
    rf_model.fit(X_train.values, y_train, feature_names=X_train.columns)

    # Extract the rules and coefficients
    rules = rf_model.get_rules()
    rules = rules[rules.coef != 0].sort_values("support", ascending=False)
    print(rules.head())


    # fit the SHAP explainer on the pipeline's classifier
    explainer = shap.TreeExplainer(pipeline['clf'])
    shap_values = explainer.shap_values(X_train_selected)

    tree_text = export_text(pipeline['clf'],show_weights=True, feature_names=X_train_selected.columns)
    print(tree_text)


    # # Explain the model with SHAP values
    # explainer = shap.TreeExplainer(pipeline['clf'])
    # shap_values = explainer.shap_values(X_train)

    # selected_features = fisher_selector.get_support(indices=True)
    selected_features = fisher_selector.selected_features_
    # or if your FisherScoreSelector supports returning the actual names:
    # selected_feature_names = X_train.columns[selected_features]
    # shap_df = pd.DataFrame(shap_values[..., 0],
    #                        columns=selected_feature_names)  # for class 0

    # shap_class0 = shap_values[..., 0]
    # shap_df = pd.DataFrame(shap_class0, columns=X_train.columns)
    # shap_df["Feature Values"] = X_train.values.tolist()


    return shap_values, X_train_selected, X_test, explainer,selected_features
