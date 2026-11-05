import json
import pandas as pd

def read_json_file(file_path):
    """
    Reads a JSON file and returns its content.

    Parameters:
        file_path (str): The path to the JSON file.

    Returns:
        dict: The content of the JSON file.
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            data = json.load(file)
            return data
    except FileNotFoundError:
        print(f"Error: The file '{file_path}' was not found.")
    except json.JSONDecodeError:
        print(f"Error: The file '{file_path}' contains invalid JSON.")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

def save_json_file(data, file_path):
    """
    Saves a dictionary to a JSON file.

    Parameters:
        data (dict): The data to be saved.
        file_path (str): The path to save the JSON file.
    """
    try:
        with open(file_path, 'w', encoding='utf-8') as file:
            json.dump(data, file, indent=4, ensure_ascii=False)
            print(f"Data successfully saved to '{file_path}'.")
    except Exception as e:
        print(f"An unexpected error occurred while saving the file: {e}")


def import_csv_as_dataframe(file_path):
    """
    Imports a CSV file as a Pandas DataFrame.

    Parameters:
        file_path (str): The path to the CSV file.

    Returns:
        pd.DataFrame: The content of the CSV file as a DataFrame.
    """
    try:
        df = pd.read_csv(file_path, delimiter=';')
        return df
    except FileNotFoundError:
        print(f"Error: The file '{file_path}' was not found.")
    except pd.errors.EmptyDataError:
        print(f"Error: The file '{file_path}' is empty.")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")